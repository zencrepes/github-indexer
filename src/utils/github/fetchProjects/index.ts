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

interface Project {
  title: string,
  id: string,
  repo: Repository,
  org: Organization,
  updatedAt: string,
  createdAt: string,
  closedAt: string | null,
}

export default class FetchProjects {
  githubToken: string
  githubLogin: string
  maxQueryIncrement: number
  configDir: string
  log: any
  cli: object
  fetchedProjects: Array<object>
  fetchedOrgProjects: Array<object>
  errorRetry: number
  getProjects: string
  getOrgProjects: string
  rateLimit: {
    limit: number,
    cost: number,
    remaining: number,
    resetAt: string | null
  }
  client: object
  cacheProjectsStream: any
  cacheOrgProjectsStream: any

  constructor(log: object, userConfig: UserConfig, configDir: string, cli: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login
    this.maxQueryIncrement = parseInt(userConfig.fetch.max_nodes, 10)
    this.configDir = configDir

    this.log = log
    this.cli = cli
    this.fetchedProjects = []
    this.fetchedOrgProjects = []
    this.errorRetry = 0
    this.getProjects = readFileSync('./src/utils/github/graphql/getProjects.graphql', 'utf8')
    this.getOrgProjects = readFileSync('./src/utils/github/graphql/getOrgProjects.graphql', 'utf8')
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

  public async load(repo: Repository, recentProject: Project | null) {
    this.fetchedProjects = []
    //Create stream for writing issues to cache
    this.cacheProjectsStream = createWriteStream(path.join(this.configDir + '/cache/', 'gh_projects_ ' + repo.org.login + '_' + repo.name + '.ndjson'), {flags: 'a'})
    await this.getProjectsPagination(null, 5, repo, recentProject)
    this.cacheProjectsStream.end()
    return this.fetchedProjects
  }

  public async loadOrgProjects(org: Organization, recentProject: Project | null) {
    this.fetchedOrgProjects = []
    //Create stream for writing issues to cache
    this.cacheOrgProjectsStream = createWriteStream(path.join(this.configDir + '/cache/', 'gh_projects_' + org.login + '.ndjson'), {flags: 'a'})
    await this.getOrgProjectsPagination(null, 5, org, recentProject)
    this.cacheOrgProjectsStream.end()
    return this.fetchedOrgProjects
  }

  private async getOrgProjectsPagination(cursor: string | null, increment: number, org: Organization, recentProject: Project | null) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      const t0 = performance.now()
      try {
        data = await graphqlQuery(
          this.client,
          this.getOrgProjects,
          {repo_cursor: cursor, increment, org_name: org.login},
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
        // Check if the repository actually exist and projects were returned
        if (data.data.organization !== null && data.data.organization.projects.edges.length > 0) {
          let lastCursor = await this.ingestOrgProjects(data, org, callDuration, recentProject)
          let queryIncrement = calculateQueryIncrement(this.fetchedOrgProjects.length, data.data.organization.projects.totalCount, this.maxQueryIncrement)
          this.log('Loading projects for Org:  ' + org.login + ' - Fetched Count / Remote Count / Query Increment: ' + this.fetchedOrgProjects.length + ' / ' + data.data.organization.projects.totalCount + ' / ' + queryIncrement)
          if (queryIncrement > 0 && lastCursor !== null) {
            //Start recurring call, to load all projects from a repository
            await this.getOrgProjectsPagination(lastCursor, queryIncrement, org, recentProject)
          }
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry)
        await this.getOrgProjectsPagination(cursor, increment, org, recentProject)
      }
    } else {
      this.log('Got too many load errors, stopping')
      process.exit(1)
    }
  }

  private async getProjectsPagination(cursor: string | null, increment: number, repo: Repository, recentProject: Project | null) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      const t0 = performance.now()
      try {
        data = await graphqlQuery(
          this.client,
          this.getProjects,
          {repo_cursor: cursor, increment, org_name: repo.org.login, repo_name: repo.name},
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
        // Check if the repository actually exist and projects were returned
        if (data.data.repository !== null && data.data.repository.projects.edges.length > 0) {
          let lastCursor = await this.ingestProjects(data, repo, callDuration, recentProject)
          let queryIncrement = calculateQueryIncrement(this.fetchedProjects.length, data.data.repository.projects.totalCount, this.maxQueryIncrement)
          this.log('Loading projects for:  ' + repo.org.login + '/' + repo.name + ' - Fetched Count / Remote Count / Query Increment: ' + this.fetchedProjects.length + ' / ' + data.data.repository.projects.totalCount + ' / ' + queryIncrement)
          if (queryIncrement > 0 && lastCursor !== null) {
            //Start recurring call, to load all projects from a repository
            await this.getProjectsPagination(lastCursor, queryIncrement, repo, recentProject)
          }
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry)
        await this.getProjectsPagination(cursor, increment, repo, recentProject)
      }
    } else {
      this.log('Got too many load errors, stopping')
      process.exit(1)
    }
  }

  private sleep(ms: number) {
    //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async ingestOrgProjects(data: any, org: Organization, callDuration: number, recentProject: Project | null) {
//    this.log('Loading from ' + OrgObj.login + ' organization')
    let lastCursor = null
    let stopLoad = false
    if (data.data.organization.projects.edges.length > 0) {
      const apiPerf = Math.round(data.data.organization.projects.edges.length / (callDuration / 1000))
      this.log('Latest call contained ' + data.data.organization.projects.edges.length + ' projects, oldest: ' + format(parseISO(data.data.organization.projects.edges[0].node.updatedAt), 'LLL do yyyy') + ' download rate: ' + apiPerf + ' projects/s')
    }
    for (let currentProject of data.data.organization.projects.edges) {
      if (recentProject !== null && new Date(currentProject.node.updatedAt).getTime() < new Date(recentProject.updatedAt).getTime()) {
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
        let projectObj = JSON.parse(JSON.stringify(currentProject.node)) //TODO - Replace this with something better to copy object ?
        projectObj.org = org
        this.fetchedOrgProjects.push(projectObj)

        //Write the content to the cache file
        this.cacheOrgProjectsStream.write(JSON.stringify(projectObj) + '\n')

        lastCursor = currentProject.cursor
      }
      lastCursor = currentProject.cursor
      if (stopLoad === true) {
        lastCursor = null
      }
    }
    return lastCursor
  }

  private async ingestProjects(data: any, repo: Repository, callDuration: number, recentProject: Project | null) {
//    this.log('Loading from ' + OrgObj.login + ' organization')
    let lastCursor = null
    let stopLoad = false
    if (data.data.repository.projects.edges.length > 0) {
      const apiPerf = Math.round(data.data.repository.projects.edges.length / (callDuration / 1000))
      this.log('Latest call contained ' + data.data.repository.projects.edges.length + ' projects, oldest: ' + format(parseISO(data.data.repository.projects.edges[0].node.updatedAt), 'LLL do yyyy') + ' download rate: ' + apiPerf + ' projects/s')
    }
    for (let currentProject of data.data.repository.projects.edges) {
      if (recentProject !== null && new Date(currentProject.node.updatedAt).getTime() < new Date(recentProject.updatedAt).getTime()) {
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
        let projectObj = JSON.parse(JSON.stringify(currentProject.node)) //TODO - Replace this with something better to copy object ?
        projectObj.repo = repo
        projectObj.org = repo.org
        this.fetchedProjects.push(projectObj)

        //Write the content to the cache file
        this.cacheProjectsStream.write(JSON.stringify(projectObj) + '\n')
        lastCursor = currentProject.cursor
      }
      lastCursor = currentProject.cursor
      if (stopLoad === true) {
        lastCursor = null
      }
    }
    return lastCursor
  }
}
