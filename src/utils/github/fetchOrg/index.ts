import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import cli from 'cli-ux'
//import {readFileSync} from 'fs'
import fetch from 'node-fetch'

import getRepos from '../graphql/getRepos'
import getReposExternal from '../graphql/getReposExternal'
import getUserRepos from '../graphql/getUserRepos'
import calculateQueryIncrement from '../utils/calculateQueryIncrement'
import graphqlQuery from '../utils/graphqlQuery'

interface Organization {
  login: string,
  id: string,
}

export default class FetchOrg {
  githubToken: string
  maxQueryIncrement: number
  log: any
  cli: object
  fetchedRepos: Array<object>
  totalReposCount: number
  errorRetry: number
  getReposExternal: string
  getRepos: string
  getUserRepos: string
  rateLimit: {
    limit: number,
    cost: number,
    remaining: number,
    resetAt: string | null
  }
  client: object
  constructor(log: object, gh_token: string, gh_increment: number, cli: object) {
    this.githubToken = gh_token
    this.maxQueryIncrement = gh_increment

    this.log = log
    this.cli = cli
    this.fetchedRepos = []
    this.totalReposCount = 0
    this.errorRetry = 0
    //this.getReposExternal = readFileSync(__dirname + '/../graphql/getReposExternal.graphql', 'utf8')
    //this.getRepos = readFileSync(__dirname + '/../graphql/getRepos.graphql', 'utf8')
    //this.getUserRepos = readFileSync(__dirname + '/../graphql/getUserRepos.graphql', 'utf8')
    this.getReposExternal = getReposExternal
    this.getUserRepos = getUserRepos
    this.getRepos = getRepos

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

  public async load(login: string) {
    this.log('Started load')

    cli.action.start('Loading repositories for organization: ' + login)
    await this.getReposPagination(null, 10, login, {})
    cli.action.stop(' completed')
    return this.fetchedRepos
  }

  private sleep(ms: number) {
    //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
    // tslint:disable-next-line no-string-based-set-timeout
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async getReposPagination(cursor: any, increment: any, orgLogin: string, orgObj: object) {
    if (this.errorRetry <= 3) {
      let data: any = {}
      await this.sleep(1000) // Wait 1s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
      try {
        data = await graphqlQuery(
          this.client,
          this.getReposExternal,
          {repo_cursor: cursor, increment, org_name: orgLogin},
          this.rateLimit,
          this.log
        )
      } catch (error) {
        this.log(error)
      }
//        this.log(data)
//        this.log(orgObj)
      if (data.data !== undefined && data.data !== null) {
        this.errorRetry = 0
        if (data.data.rateLimit !== undefined) {
          this.rateLimit = data.data.rateLimit
        }
        const orgObj = {
          login: data.data.organization.login,
          name: data.data.organization.name,
          id: data.data.organization.id,
          url: data.data.organization.url,
        }
        let lastCursor = await this.loadRepositories(data, orgObj)
        let queryIncrement = calculateQueryIncrement(this.totalReposCount, data.data.organization.repositories.totalCount, this.maxQueryIncrement)
        this.log('Org: ' + orgObj.login + ' -> Fetched Count / Remote Count / Query Increment: ' + this.totalReposCount + ' / ' + data.data.organization.repositories.totalCount + ' / ' + queryIncrement)
        if (queryIncrement > 0) {
          await this.getReposPagination(lastCursor, queryIncrement, orgLogin, orgObj)
        }
      } else {
        this.errorRetry = this.errorRetry + 1
        this.log('Error loading content, current count: ' + this.errorRetry)
        await this.getReposPagination(cursor, increment, orgLogin, orgObj)
      }
    } else {
      this.log('Got too many load errors, stopping')
      process.exit(1)
    }
  }

  private async loadRepositories(data: any, orgObj: Organization) {
    let lastCursor = null
    for (let currentRepo of data.data.organization.repositories.edges) {
      let repoObj = JSON.parse(JSON.stringify(currentRepo.node)) //TODO - Replace this with something better to copy object ?
      repoObj.org = orgObj
      this.fetchedRepos.push(repoObj)
      lastCursor = currentRepo.cursor
    }
    this.totalReposCount = this.totalReposCount + Object.entries(data.data.organization.repositories.edges).length
    //this.log('Fetched a total of ' + this.totalReposCount + ' repositories')

    return lastCursor
  }
}
