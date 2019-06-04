import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import {format, parseISO} from 'date-fns'
import {createWriteStream} from 'fs'
//import { fetch } from 'apollo-env'
import fetch from 'node-fetch'
import * as path from 'path'
import {performance} from 'perf_hooks'

import getLabels from '../graphql/getLabels'
import calculateQueryIncrement from '../utils/calculateQueryIncrement'
import graphqlQuery from '../utils/graphqlQuery'

interface UserConfig {
  fetch: {
    max_nodes: string,
  },
  github: {
    token: string,
    login: string
  }
}

interface Organization {
  login: string,
  id: string,
}

interface Repository {
  name: string,
  id: string,
  org: Organization,
  active: boolean
}

export default class FetchLabels {
  githubToken: string
  githubLogin: string
  maxQueryIncrement: number
  configDir: string
  log: any
  cli: object
  fetchedLabels: Array<object>
  errorRetry: number
  getLabels: string
  rateLimit: {
    limit: number,
    cost: number,
    remaining: number,
    resetAt: string | null
  }
  client: object
  cacheStream: any

  constructor(log: object, userConfig: UserConfig, configDir: string, cli: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login
    this.maxQueryIncrement = parseInt(userConfig.fetch.max_nodes, 10)
    this.configDir = configDir

    this.log = log
    this.cli = cli
    this.fetchedLabels = []
    this.errorRetry = 0
    //this.getLabels = readFileSync(__dirname + '/../graphql/getLabels.graphql', 'utf8')
    this.getLabels = getLabels

    this.rateLimit = {
      limit: 5000,
      cost: 1,
      remaining: 5000,
      resetAt: null
    }
    const httpLink = new HttpLink({uri: 'https://api.github.com/graphql', fetch: fetch as any})
    const cache = new InMemoryCache()
    //const cache = new InMemoryCache().restore(window.__APOLLO_STATE__)

    const authMiddleware = new ApolloLink((operation: any, forward: any) => {
      // add the authorization to the headers
      operation.setContext({
        headers: {
          authorization: this.githubToken ? `Bearer ${this.githubToken}` : '',
        }
      })
      return forward(operation).map((response: {errors: Array<object> | undefined, data: {errors: Array<object>}}) => {
        if (response.errors !== undefined && response.errors.length > 0) {
          response.data.errors = response.errors
        }
        return response
      })
    })

    this.client = new ApolloClient({
      link: concat(authMiddleware, httpLink),
      //link: authLink.concat(link),
      cache,
    })
  }

  public async load(repo: Repository) {
    this.fetchedLabels = []
    //Create stream for writing issues to cache
    this.cacheStream = createWriteStream(path.join(this.configDir + '/cache/', 'gh_labels_' + repo.org.login + '_' + repo.name + '.ndjson'), {flags: 'a'})
    await this.getLabelsPagination(null, 5, repo)
    this.cacheStream.end()
    return this.fetchedLabels
  }

  private sleep(ms: number) {
    //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async getLabelsPagination(cursor: string | null, increment: number, repoObj: Repository) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      const t0 = performance.now()
      try {
        data = await graphqlQuery(
          this.client,
          this.getLabels,
          {repo_cursor: cursor, increment, org_name: repoObj.org.login, repo_name: repoObj.name},
          this.rateLimit,
          this.log
        )
      } catch (error) {
        this.log(error)
      }
      const t1 = performance.now()
      const callDuration = t1 - t0
//        this.log(data)
//        this.log(OrgObj)
      if (data.data !== undefined && data.data !== null) {
        this.errorRetry = 0
        if (data.data.rateLimit !== undefined) {
          this.rateLimit = data.data.rateLimit
        }
        //updateChip(data.data.rateLimit)
        let lastCursor = await this.loadLabels(data, repoObj, callDuration)
        let queryIncrement = calculateQueryIncrement(this.fetchedLabels.length, data.data.repository.labels.totalCount, this.maxQueryIncrement)
        this.log('Repo: ' + repoObj.org.login + '/' + repoObj.name + ' -> Fetched Count / Remote Count / Query Increment: ' + this.fetchedLabels.length + ' / ' + data.data.repository.labels.totalCount + ' / ' + queryIncrement)
        if (queryIncrement > 0 && lastCursor !== null) {
          await this.getLabelsPagination(lastCursor, queryIncrement, repoObj)
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry)
        await this.getLabelsPagination(cursor, increment, repoObj)
      }
    } else {
      this.log('Got too many load errors, stopping')
      process.exit(1)
    }
  }

  private async loadLabels(data: any, repoObj: Repository, callDuration: number) {
//    this.log('Loading from ' + OrgObj.login + ' organization')
    let lastCursor = null

    if (data.data.repository.labels.edges.length > 0) {
      const apiPerf = Math.round(data.data.repository.labels.edges.length / (callDuration / 1000))
      this.log('Latest call contained ' + data.data.repository.labels.edges.length + ' issues, oldest: ' + format(parseISO(data.data.repository.labels.edges[0].node.updatedAt), 'LLL do yyyy') + ' download rate: ' + apiPerf + ' issues/s')
    }
    for (let currentLabel of data.data.repository.labels.edges) {
      let labelObj = JSON.parse(JSON.stringify(currentLabel.node)) //TODO - Replace this with something better to copy object ?
      labelObj.repo = repoObj
      labelObj.org = repoObj.org
      this.fetchedLabels.push(labelObj)

      //Write the content to the cache file
      this.cacheStream.write(JSON.stringify(labelObj) + '\n')

      lastCursor = currentLabel.cursor
    }
    return lastCursor
  }
}
