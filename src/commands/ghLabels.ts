import {ApiResponse, Client} from '@elastic/elasticsearch'
import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import FetchLabels from '../utils/github/fetchLabels/index'
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

export default class GhLabels extends Command {
  static description = 'Fetch labels from GitHub'

  static examples = [
    '$ github-indexer ghLabels',
  ]

  static flags = {
    help: flags.help({char: 'h'}),
  }

  /*
    The aim of this script is to fetch all labels associated with active repositories.
    It does the following:
     - Fetch a list of repositories from Elasticsearch
     - Fetch updated labels for each repository
     - Send back the content to Elasticsearch
   */
  async run() {
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const es_port = userConfig.elasticsearch.port
    const es_host = userConfig.elasticsearch.host
    const reposIndexName = userConfig.elasticsearch.indices.repos
    const indexLabelPrefix = userConfig.elasticsearch.indices.labels

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
    const fetchData = new FetchLabels(this.log, userConfig, this.config.configDir, cli)

    this.log('Starting to grab labels')
    for (let repo of activeRepos) {
      //A - Check if repo index exists, if not create
      const labelsIndex = (indexLabelPrefix + repo.org.login + '_' + repo.name).toLocaleLowerCase()
      const testIndex = await client.indices.exists({index: labelsIndex})
      if (testIndex.body === false) {
        cli.action.start('Elasticsearch Index ' + labelsIndex + ' does not exist, creating')
        const mappings = await loadYamlFile('./src/schemas/labels.yml')
        const settings = await loadYamlFile('./src/schemas/settings.yml')
        await client.indices.create({index: labelsIndex, body: {settings, mappings}})
        cli.action.stop(' created')
      } else {
        // If index exists, flush it. It's the only way to ensure records in GitHub and in Elasticsearch remains in sync
        await client.indices.flush({index: labelsIndex})
      }
      //C - Fetch labels from GitHub into a large array
      cli.action.start('Grabbing labels for: ' + repo.org.login + '/' + repo.name + ' (will fetch up to ' + repo.labels.totalCount + ' labels)')
      let fetchedLabels = await fetchData.load(repo)
      cli.action.stop(' done')

      //D - Break down the labels response in multiple batches
      const esPayloadChunked = await chunkArray(fetchedLabels, 100)
      //E- Push the results back to Elastic Search
      for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
        cli.action.start('Submitting data to ElasticSearch into ' + labelsIndex + ' (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
        let formattedData = ''
        for (let rec of esPayloadChunk) {
          formattedData = formattedData + JSON.stringify({
            index: {
              _index: labelsIndex,
              _id: (rec as Repository).id
            }
          }) + '\n' + JSON.stringify(rec) + '\n'
        }
        await client.bulk({index: labelsIndex, refresh: 'wait_for', body: formattedData})
        cli.action.stop(' done')
      }
    }
  }
}
