import {ApiResponse, Client} from '@elastic/elasticsearch'
import {flags} from '@oclif/command'
import cli from 'cli-ux'
import * as fs from 'fs'
import * as loadYamlFile from 'load-yaml-file'
import * as _ from 'lodash'
import * as path from 'path'

import Command from '../base'
import chunkArray from '../utils/misc/chunkArray'

interface SearchResponse<T> {
  hits: {
    hits: Array<{
      _source: T;
    }>
  }
}

interface Organization {
  login: string,
  id: string,
}
// Define the interface of the source object
interface Repository {
  name: string,
  id: string,
  issues: {
    totalCount: number,
    edges: Array<{
      node: {
        id: string,
        updatedAt: string,
        __typename: string
      },
    }>,
  },
  org: Organization,
  active: boolean
}

export default class CfRepos extends Command {
  static description = 'Enable/disable repositories by reading the configuration file'

  static examples = [
    '$ github-indexer cfRepo',
  ]

  static flags = {
    ...Command.flags,
    help: flags.help({char: 'h'}),
  }
  /*
    The aim of this script is to update which repositories should be active or inactive.
    It does the following:
     - Fetch a list of repositories from Elasticsearch
     - Search for each repository in the configuration file, to find if it should be enabled or disabled
     - Send back the content to Elasticsearch
   */
  async run() {
    const {flags} = this.parse(CfRepos)
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const {esport, eshost, esrepo} = flags
    const es_port = (esport !== undefined ? esport : userConfig.elasticsearch.port)
    const es_host = (eshost !== undefined ? eshost : userConfig.elasticsearch.host)
    const reposIndexName = (esrepo !== undefined ? esrepo : userConfig.elasticsearch.indices.repos)

    //1- Test if an index exists, if it does not, exit.
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
      this.log('Could not find the index, please run ghRepos first')
    }
    cli.action.stop(' done')

    //2- Grab the repositories data from ElasticSearch
    cli.action.start('Grabbing existing data from ElasticSearch')
    let esRepos: ApiResponse<SearchResponse<Repository>> = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match_all: {}
        }
      }
    })
    cli.action.stop(' done')

    //3- Load content from the configuration file
    cli.action.start('Grabbing repo configuration from file: ' + path.join(this.config.configDir, 'repositories.yml'))
    let reposConfig: Array<object> = []
    if (fs.existsSync(path.join(this.config.configDir, 'repositories.yml'))) {
      reposConfig = await loadYamlFile(path.join(this.config.configDir, 'repositories.yml'))
    } else {
      this.error('Unable to find the repositories config file (' + path.join(this.config.configDir, 'repositories.yml') + '), please run ghRepos first', {exit: 1})
    }
    cli.action.stop(' done')

    //4- Update the array with the value from the configuration file
    cli.action.start('Comparing Elasticsearch data with flags in configuration file')
    const updatedData = esRepos.body.hits.hits.map(repo => {
      const cfgRepo = _.find(reposConfig, (o: object) => (o as any)[repo._source.org.login + '/' + repo._source.name] !== undefined)
      if (repo._source.active !== (cfgRepo as any)[repo._source.org.login + '/' + repo._source.name]) {
        this.log('Changing: ' + repo._source.org.login + '/' + repo._source.name + ' from: ' + repo._source.active + ' to: ' + (cfgRepo as any)[repo._source.org.login + '/' + repo._source.name])
      }
      return {
        ...repo._source,
        active: (cfgRepo as any)[repo._source.org.login + '/' + repo._source.name]
      }
    })
    cli.action.stop(' done')

    //5- Push the results back to Elastic Search in chunks of 100
    cli.action.start('Pushing data back to Elasticsearch')
    //Split the array in chunks of 100
    const esPayloadChunked = await chunkArray(updatedData, 100)
    for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
      cli.action.start('Submitting data to ElasticSearch (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
      let formattedData = ''
      for (let rec of esPayloadChunk) {
        formattedData = formattedData + JSON.stringify({
          index: {
            _index: reposIndexName,
            _id: (rec as Repository).id
          }
        }) + '\n' + JSON.stringify(rec) + '\n'
      }
      await client.bulk({index: reposIndexName, refresh: 'wait_for', body: formattedData})
      cli.action.stop(' done')
    }
  }
}
