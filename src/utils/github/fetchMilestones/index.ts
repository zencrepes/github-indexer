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

import getMilestones from '../graphql/getMilestones'
import calculateQueryIncrement from '../utils/calculateQueryIncrement'
import graphqlQuery from '../utils/graphqlQuery'

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

export default class FetchMilestones {
  githubToken: string
  maxQueryIncrement: number
  configDir: string
  log: any
  cli: object
  fetchedMilestones: Array<object>
  errorRetry: number
  getMilestones: string
  rateLimit: {
    limit: number,
    cost: number,
    remaining: number,
    resetAt: string | null
  }
  client: object
  cacheStream: any

  constructor(log: object, gh_token: string, gh_increment: number, configDir: string, cli: object) {
    this.githubToken = gh_token
    this.maxQueryIncrement = gh_increment
    this.configDir = configDir

    this.log = log
    this.cli = cli
    this.fetchedMilestones = []
    this.errorRetry = 0
    //this.getMilestones = readFileSync(__dirname + '/../graphql/getMilestones.graphql', 'utf8')
    this.getMilestones = getMilestones

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
    this.fetchedMilestones = []
    //Create stream for writing milestones to cache
    this.cacheStream = createWriteStream(path.join(this.configDir + '/cache/', repo.org.login + '_' + repo.name + '.ndjson'), {flags: 'a'})
    await this.getMilestonesPagination(null, 5, repo, recentIssue)
    this.cacheStream.end()
    return this.fetchedMilestones
  }

  private sleep(ms: number) {
    //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async getMilestonesPagination(cursor: string | null, increment: number, repoObj: Repository, recentIssue: Issue | null) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      const t0 = performance.now()
      try {
        data = await graphqlQuery(
          this.client,
          this.getMilestones,
          {repo_cursor: cursor, increment, org_name: repoObj.org.login, repo_name: repoObj.name},
          this.rateLimit,
          this.log
        )
      } catch (error) {
        this.log(error)
      }
      const t1 = performance.now()
      const callDuration = t1 - t0
      if (data.data !== undefined && data.data !== null) {
        this.errorRetry = 0
        if (data.data.rateLimit !== undefined) {
          this.rateLimit = data.data.rateLimit
        }
        //updateChip(data.data.rateLimit)
        let lastCursor = await this.loadIssues(data, repoObj, callDuration, recentIssue)
        let queryIncrement = calculateQueryIncrement(this.fetchedMilestones.length, data.data.repository.milestones.totalCount, this.maxQueryIncrement)
        this.log('Repo: ' + repoObj.org.login + '/' + repoObj.name + ' -> Fetched Count / Remote Count / Query Increment: ' + this.fetchedMilestones.length + ' / ' + data.data.repository.milestones.totalCount + ' / ' + queryIncrement)
        if (queryIncrement > 0 && lastCursor !== null) {
          await this.getMilestonesPagination(lastCursor, queryIncrement, repoObj, recentIssue)
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry, recentIssue)
        await this.getMilestonesPagination(cursor, increment, repoObj, recentIssue)
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

    if (data.data.repository.milestones.edges.length > 0) {
      const apiPerf = Math.round(data.data.repository.milestones.edges.length / (callDuration / 1000))
      this.log('Latest call contained ' + data.data.repository.milestones.edges.length + ' milestones, oldest: ' + format(parseISO(data.data.repository.milestones.edges[0].node.updatedAt), 'LLL do yyyy') + ' download rate: ' + apiPerf + ' milestones/s')
    }
    for (let currentIssue of data.data.repository.milestones.edges) {
      if (recentIssue !== null && new Date(currentIssue.node.updatedAt).getTime() < new Date(recentIssue.updatedAt).getTime()) {
        this.log('Issue already loaded, stopping entire load')
        // Issues are loaded from newest to oldest, when it gets to a point where updated date of a loaded milestone
        // is equal to updated date of a local milestone, it means there is no "new" content, but there might still be
        // milestones that were not loaded for any reason. So the system only stops loaded if totalCount remote is equal
        //  to the total number of milestones locally
        // Note Mar 21: This logic might be fine when the number of milestones is relatively small, definitely problematic for large repositories.
        // Commenting it out for now, it will not keep looking in the past if load is interrupted for some reason.
        //if (data.data.repository.milestones.totalCount === cfgIssues.find({'repo.id': repoObj.id}).count()) {
        //    stopLoad = true;
        //}
        stopLoad = true
      } else {
        let milestoneObj = JSON.parse(JSON.stringify(currentIssue.node)) //TODO - Replace this with something better to copy object ?
        milestoneObj.repo = repoObj
        milestoneObj.org = repoObj.org
        this.fetchedMilestones.push(milestoneObj)

        //Write the content to the cache file
        this.cacheStream.write(JSON.stringify(milestoneObj) + '\n')

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
