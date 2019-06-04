import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import {format, parseISO} from 'date-fns'
import {createWriteStream, readFileSync} from 'fs'
//import { fetch } from 'apollo-env'
import fetch from 'node-fetch'
import * as path from 'path'
import {performance} from 'perf_hooks'

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

interface Issue {
  title: string,
  id: string,
  repo: Repository,
  org: Organization,
  updatedAt: string,
  createdAt: string,
  closedAt: string | null,
}

export default class FetchIssues {
  githubToken: string
  githubLogin: string
  maxQueryIncrement: number
  configDir: string
  log: any
  cli: object
  fetchedIssues: Array<object>
  errorRetry: number
  getIssues: string
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
    this.fetchedIssues = []
    this.errorRetry = 0
    this.getIssues = readFileSync(__dirname + '/../graphql/getIssues.graphql', 'utf8')

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

  public async load(repo: Repository, recentIssue: Issue | null) {
    this.fetchedIssues = []
    //Create stream for writing issues to cache
    this.cacheStream = createWriteStream(path.join(this.configDir + '/cache/', repo.org.login + '_' + repo.name + '.ndjson'), {flags: 'a'})
    await this.getIssuesPagination(null, 5, repo, recentIssue)
    this.cacheStream.end()
    return this.fetchedIssues
  }

  private sleep(ms: number) {
    //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async getIssuesPagination(cursor: string | null, increment: number, repoObj: Repository, recentIssue: Issue | null) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      const t0 = performance.now()
      try {
        data = await graphqlQuery(
          this.client,
          this.getIssues,
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
        let lastCursor = await this.loadIssues(data, repoObj, callDuration, recentIssue)
        let queryIncrement = calculateQueryIncrement(this.fetchedIssues.length, data.data.repository.issues.totalCount, this.maxQueryIncrement)
        this.log('Repo: ' + repoObj.org.login + '/' + repoObj.name + ' -> Fetched Count / Remote Count / Query Increment: ' + this.fetchedIssues.length + ' / ' + data.data.repository.issues.totalCount + ' / ' + queryIncrement)
        if (queryIncrement > 0 && lastCursor !== null) {
          await this.getIssuesPagination(lastCursor, queryIncrement, repoObj, recentIssue)
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry, recentIssue)
        await this.getIssuesPagination(cursor, increment, repoObj, recentIssue)
      }
    } else {
      this.log('Got too many load errors, stopping')
      process.exit(1)
    }
  }

  private async loadIssues(data: any, repoObj: Repository, callDuration: number, recentIssue: Issue | null) {
//    this.log('Loading from ' + OrgObj.login + ' organization')
    let lastCursor = null
    let stopLoad = false

    if (data.data.repository.issues.edges.length > 0) {
      const apiPerf = Math.round(data.data.repository.issues.edges.length / (callDuration / 1000))
      this.log('Latest call contained ' + data.data.repository.issues.edges.length + ' issues, oldest: ' + format(parseISO(data.data.repository.issues.edges[0].node.updatedAt), 'LLL do yyyy') + ' download rate: ' + apiPerf + ' issues/s')
    }
    for (let currentIssue of data.data.repository.issues.edges) {
      if (recentIssue !== null && new Date(currentIssue.node.updatedAt).getTime() < new Date(recentIssue.updatedAt).getTime()) {
        this.log('Issue already loaded, stopping entire load')
        // Issues are loaded from newest to oldest, when it gets to a point where updated date of a loaded issue
        // is equal to updated date of a local issue, it means there is no "new" content, but there might still be
        // issues that were not loaded for any reason. So the system only stops loaded if totalCount remote is equal
        //  to the total number of issues locally
        // Note Mar 21: This logic might be fine when the number of issues is relatively small, definitely problematic for large repositories.
        // Commenting it out for now, it will not keep looking in the past if load is interrupted for some reason.
        //if (data.data.repository.issues.totalCount === cfgIssues.find({'repo.id': repoObj.id}).count()) {
        //    stopLoad = true;
        //}
        stopLoad = true
      } else {
        let issueObj = JSON.parse(JSON.stringify(currentIssue.node)) //TODO - Replace this with something better to copy object ?
        issueObj.repo = repoObj
        issueObj.org = repoObj.org
        this.fetchedIssues.push(issueObj)

        //Write the content to the cache file
        this.cacheStream.write(JSON.stringify(issueObj) + '\n')

        lastCursor = currentIssue.cursor
      }
      lastCursor = currentIssue.cursor
      if (stopLoad === true) {
        lastCursor = null
      }
    }
    return lastCursor
  }
}
