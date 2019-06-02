import cli from 'cli-ux'
import {readFileSync} from 'fs'

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

export default class FetchRepo {
  githubToken: string
  githubLogin: string
  maxQueryIncrement: number
  log: any
  cli: object
  fetchedRepos: Array<object>
  errorRetry: number
  getSingleRepo: string
  rateLimit: {
    limit: number,
    cost: number,
    remaining: number,
    resetAt: string | null
  }
  client: object

  constructor(log: object, userConfig: UserConfig, cli: object, apolloClient: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login
    this.maxQueryIncrement = parseInt(userConfig.fetch.max_nodes, 10)

    this.log = log
    this.cli = cli
    this.client = apolloClient
    this.fetchedRepos = []
    this.errorRetry = 0
    this.getSingleRepo = readFileSync('./src/utils/github/graphql/getSingleRepo.graphql', 'utf8')

    this.rateLimit = {
      limit: 5000,
      cost: 1,
      remaining: 5000,
      resetAt: null
    }
  }

  public async load(login: string, repo: string) {
    this.log('Started load')

    cli.action.start('Loading repository: ' + login + '/' + repo)
    const data = await graphqlQuery(
      this.client,
      this.getSingleRepo,
      {org_name: login, repo_name: repo},
      this.rateLimit,
      this.log
    )
    if (data.data.repository !== null) {
      let repoObj = JSON.parse(JSON.stringify(data.data.repository)) //TODO - Replace this with something better to copy object ?
      repoObj.org = {
        login: data.data.repository.owner.login,
        name: data.data.repository.owner.login,
        id: data.data.repository.owner.id,
        url: data.data.repository.owner.url,
      }
      this.fetchedRepos.push(repoObj)
    } else {
      this.log('ERROR: Either this repository does not exist, or you do not have the necessary permissions')
    }

    cli.action.stop(' completed')
    return this.fetchedRepos
  }
}
