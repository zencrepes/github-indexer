import {ApiResponse, Client} from '@elastic/elasticsearch'
import {flags} from '@oclif/command'
import cli from 'cli-ux'
import * as jsYaml from 'js-yaml'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import Command from '../base'
import YmlIssues from '../schemas/issues'
import YmlSettings from '../schemas/settings'
import FetchIssues from '../utils/github/fetchIssues/index'
import chunkArray from '../utils/misc/chunkArray'

interface SearchResponse<T> {
  hits: {
    hits: Array<{
      _source: T;
    }>
  }
}

// Define the interface of the source object
interface Repository {
  name: string,
  url: string,
  id: string,
  databaseId: number,
  diskUsage: number,
  forkCount: number,
  isPrivate: boolean,
  isArchived: boolean,
  owner: {
    id: string,
    login: string,
    url: string,
  },
  issues: {
    totalCount: number,
    edges: Array<{
      node: {
        id: string,
        updatedAt: string,
        __typename: string
      },
      __typename: string
    }>,
    __typename: string
  },
  labels: {
    totalCount: number,
    __typename: string
  },
  milestones: {
    totalCount: number,
    __typename: string
  },
  pullRequests: {
    totalCount: number,
    __typename: string
  },
  releases: {
    totalCount: number,
    __typename: string
  },
  projects: {
    totalCount: number,
    __typename: string
  },
  __typename: string,
  org: Organization,
  active: boolean
}

interface Organization {
  login: string,
  id: string,
}

// Define the interface of the source object
interface Issue {
  title: string,
  id: string,
  repo: Repository,
  org: Organization,
  updatedAt: string,
  createdAt: string,
  closedAt: string | null,
}

export default class GhIssues extends Command {
  static description = 'Fetch issues from GitHub'

  static examples = [
    '$ github-indexer ghIssues',
  ]

  static flags = {
    ...Command.flags,
    help: flags.help({char: 'h'}),
  }

  /*
    The aim of this script is to fetch all issues associated with active repositories.
    It does the following:
     - Fetch a list of repositories from Elasticsearch
     - Fetch updated issues for each repository
     - Send back the content to Elasticsearch
   */
  async run() {
    const {flags} = this.parse(GhIssues)
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const {esport, eshost, esrepo} = flags
    const es_port = (esport !== undefined ? esport : userConfig.elasticsearch.port)
    const es_host = (eshost !== undefined ? eshost : userConfig.elasticsearch.host)
    const reposIndexName = (esrepo !== undefined ? esrepo : userConfig.elasticsearch.indices.repos)
    const indexIssuePrefix = userConfig.elasticsearch.indices.issues

    //1- Test if an index exists, if it does not, create it.
    cli.action.start('Checking if index: ' + reposIndexName + ' exists')
    const client = new Client({node: es_host + ':' + es_port})
    const healthCheck: ApiResponse = await client.cluster.health()
    if (healthCheck.body.status === 'red') {
      this.log('Elasticsearch cluster is not in an healthy state, exiting')
      this.log(healthCheck.body)
      process.exit(1)
    }
    const testIndex = await client.indices.exists({index: reposIndexName})
    if (testIndex.body === false) {
      this.error('Index: ' + reposIndexName + ' does not exists, please configure repositories first', {exit: 1})
    }
    cli.action.stop(' done')

    //2- Grab the active repositories from Elasticsearch
    cli.action.start('Grabbing the active repositories from ElasticSearch')
    let esRepos: ApiResponse<SearchResponse<Repository>> = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match: {
            active: {
              query: true
            }
          }
        }
      }
    })
    //console.log(esRepos.body.hits.hits);
    const activeRepos = esRepos.body.hits.hits.map(r => r._source)
    cli.action.stop(' done')

    if (activeRepos.length === 0) {
      this.error('The script could not find any active repositories. Please use ghRepos and cfRepos first.', {exit: 1})
    }
    const fetchData = new FetchIssues(this.log, userConfig, this.config.configDir, cli)

    this.log('Starting to grab issues')
    for (let repo of activeRepos) {
      //A - Check if repo index exists, if not create
      const issuesIndex = (indexIssuePrefix + repo.org.login + '_' + repo.name).toLocaleLowerCase()
      const testIndex = await client.indices.exists({index: issuesIndex})
      if (testIndex.body === false) {
        cli.action.start('Elasticsearch Index ' + issuesIndex + ' does not exist, creating')
        const mappings = await jsYaml.safeLoad(YmlIssues)
        const settings = await jsYaml.safeLoad(YmlSettings)
        await client.indices.create({index: issuesIndex, body: {settings, mappings}})
        cli.action.stop(' created')
      }

      //B - Find the most recent issue
      let searchResult: ApiResponse<SearchResponse<Issue>> = await client.search({
        index: issuesIndex,
        body: {
          query: {
            match_all: {}
          },
          size: 1,
          sort: [
            {
              updatedAt: {
                order: 'desc'
              }
            }
          ]
        }
      })
      let recentIssue = null
      if (searchResult.body.hits.hits.length > 0) {
        recentIssue = searchResult.body.hits.hits[0]._source
      }

      //C - Fetch issues from GitHub into a large array
      cli.action.start('Grabbing issues for: ' + repo.org.login + '/' + repo.name + ' (will fetch up to ' + repo.issues.totalCount + ' issues)')
      let fetchedIssues = await fetchData.load(repo, recentIssue)
      cli.action.stop(' done')

      //D - Break down the issues response in multiple batches
      const esPayloadChunked = await chunkArray(fetchedIssues, 100)
      //E- Push the results back to Elastic Search
      for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
        cli.action.start('Submitting data to ElasticSearch into ' + issuesIndex + ' (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
        let formattedData = ''
        for (let rec of esPayloadChunk) {
          formattedData = formattedData + JSON.stringify({
            index: {
              _index: issuesIndex,
              _id: (rec as Repository).id
            }
          }) + '\n' + JSON.stringify(rec) + '\n'
        }
        await client.bulk({index: issuesIndex, refresh: 'wait_for', body: formattedData})
        cli.action.stop(' done')
      }
    }
  }
}
