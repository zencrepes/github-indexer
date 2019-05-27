import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import cli from 'cli-ux'
import {readFileSync} from 'fs'
import fetch from 'node-fetch'

import calculateQueryIncrement from '../utils/calculateQueryIncrement'
import graphqlQuery from '../utils/graphqlQuery'

export default class FetchOrg {
  constructor(log: object, error: object, userConfig: object, cli: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login
    this.maxQueryIncrement = userConfig.fetch.max_nodes

    this.log = log
    this.error = error
    this.cli = cli
    this.fetchedRepos = []
    this.githubOrgs = []
    this.totalReposCount = 0
    this.state = {}
    this.errorRetry = 0
    this.getReposExternal = readFileSync('./src/utils/github/graphql/getReposExternal.graphql', 'utf8')
    this.getRepos = readFileSync('./src/utils/github/graphql/getRepos.graphql', 'utf8')
    this.getUserRepos = readFileSync('./src/utils/github/graphql/getUserRepos.graphql', 'utf8')

    this.rateLimit = {
      limit: 5000,
      cost: 1,
      remaining: 5000,
      resetAt: null
    }

    const httpLink = new HttpLink({uri: 'https://api.github.com/graphql', fetch})
    const cache = new InMemoryCache()
    //const cache = new InMemoryCache().restore(window.__APOLLO_STATE__)

    const authMiddleware = new ApolloLink((operation: any, forward: any) => {
      // add the authorization to the headers
      operation.setContext({
        headers: {
          authorization: this.githubToken ? `Bearer ${this.githubToken}` : '',
        }
      })
      return forward(operation).map(response => {
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

  public async load(login) {
    this.log('Started load')

    cli.action.start('Loading repositories for organizations: ' + login)
    await this.getReposPagination(null, 10, login)
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
      let data = {}
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
      if (data.data !== undefined && data.data.errors !== undefined && data.data.errors.length > 0) {
        data.data.errors.forEach((error: object) => {
          this.log(error.message)
        })
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

  private async loadRepositories(data, orgObj) {
//    this.log('Loading from ' + OrgObj.login + ' organization')

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
