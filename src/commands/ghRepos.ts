import {ApiResponse, Client} from '@elastic/elasticsearch'
import {flags} from '@oclif/command'
import cli from 'cli-ux'
import * as fs from 'fs'
import * as jsYaml from 'js-yaml'
import * as loadYamlFile from 'load-yaml-file'
import * as _ from 'lodash'
import * as path from 'path'

import Command from '../base'
import YmlRepos from '../schemas/repositories'
import YmlSettings from '../schemas/settings'
import FetchAffiliated from '../utils/github/fetchAffiliated/index'
import FetchOrg from '../utils/github/fetchOrg/index'
import FetchRepo from '../utils/github/fetchRepo/index'
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

export default class GhRepos extends Command {
  static description = 'Fetch repositories from GitHub (FIRST STEP, start HERE)'

  static examples = [
    '$ github-indexer ghRepo -g affiliated',
    '$ github-indexer ghRepo -g org -o jetbrains',
    '$ github-indexer ghRepo -g repo -o microsoft -r vscode',
  ]

  static flags = {
    ...Command.flags,
    help: flags.help({char: 'h'}),
    grab: flags.string({
      char: 'g',
      required: true,
      options: ['affiliated', 'org', 'repo'],
      description: 'Select how to fetch repositories'
    }),
    org: flags.string({
      char: 'o',
      required: false,
      description: 'GitHub organization login'
    }),
    repo: flags.string({
      char: 'r',
      required: false,
      description: 'GitHub repository name'
    }),
    // flag with no value (-f, --force)
    force: flags.boolean({char: 'f', default: false, description: 'Make all fetched repositories active by default'}),
  }

  async run() {
    const {flags} = this.parse(GhRepos)
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const {grab, org, repo, force, esport, eshost, esrepo, glogin, gtoken, gincrement} = flags
    const es_port = (esport !== undefined ? esport : userConfig.elasticsearch.port)
    const es_host = (eshost !== undefined ? eshost : userConfig.elasticsearch.host)
    const reposIndexName = (esrepo !== undefined ? esrepo : userConfig.elasticsearch.indices.repos)
    const gh_login = (glogin !== undefined ? glogin : userConfig.github.login)
    const gh_token = (gtoken !== undefined ? gtoken : userConfig.github.token)
    const gh_increment = parseInt((gincrement !== undefined ? gincrement : userConfig.fetch.max_nodes), 10)

    //1- Grab the repositories from GitHub
    let fetchedRepos: Array<any> = []
    if (grab === 'affiliated') {
      this.log('Starting to fetch data from affiliated organizations')
      const fetchData = new FetchAffiliated(this.log, this.error, gh_login, gh_token, gh_increment, cli)
      fetchedRepos = await fetchData.load()
    } else if (grab === 'org' && org !== undefined) {
      this.log('Starting to fetch data from org: ' + org)
      const fetchData = new FetchOrg(this.log, gh_token, gh_increment, cli)
      fetchedRepos = await fetchData.load(org)
    } else if (grab === 'repo' && org !== undefined && repo !== undefined) {
      this.log('Starting to fetch data from repo: ' + org + '/' + repo)
      const fetchData = new FetchRepo(this.log, gh_token, gh_increment, cli)
      fetchedRepos = await fetchData.load(org, repo)
    }

    //2- Test if an index exists, if it does not, create it.
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
      cli.action.start('Elasticsearch Index gh_repos does not exist, creating')
      const mappings = await jsYaml.safeLoad(YmlRepos)
      const settings = await jsYaml.safeLoad(YmlSettings)
      //const mappings = await loadYamlFile(__dirname + '../schemas/repositories.yml')
      //const settings = await loadYamlFile(__dirname + '../schemas/settings.yml')
      await client.indices.create({index: reposIndexName, body: {settings, mappings}})
    }
    cli.action.stop(' done')

    cli.action.start('Grabbing data from ElasticSearch and merging with new data')
    //3- Grab the repositories data from ElasticSearch
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

    //4- Loop through the newly grabbed data and see if there is a corresponding result in ES
    let esPayload: Array<object> = []
    fetchedRepos.map((repo: Repository) => {
      const existingRepo = _.find(esRepos.body.hits.hits, function (o) { return o._source.id === repo.id })
      const updatedRepo = {...repo}
      if (existingRepo !== undefined) {
        //If the repo exist, we are only looking for the active flag
        updatedRepo.active = existingRepo._source.active
      } else {
        updatedRepo.active = false
      }
      if (force === true) {
        updatedRepo.active = true
      }
      //If submitting only one repository, assumption is that it should be active.
      if (grab === 'repo') {
        this.log('Activating repository: ' + repo.org.login + '/' + repo.name)
        updatedRepo.active = true
      }
      esPayload.push(updatedRepo)
    })
    cli.action.stop(' done')
    this.log('About to submit (create or update) data about ' + esPayload.length + ' repo(s) to Elasticsearch')

    //Split the array in chunks of 100
    const esPayloadChunked = await chunkArray(esPayload, 100)
    //5- Push the results back to Elastic Search
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

    //6- Update the configuration by re-downloading all data from ElasticSearch to create the configuration file
    cli.action.start('Refreshing the repositories configuration file')
    esRepos = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match_all: {}
        }
      }
    })

    //const esResults = _.sortBy(esRepos.body.hits.hits, [function (o) { if (o.org !== null) { return o.user } else { return '' } }])
    const esResults = _.sortBy(esRepos.body.hits.hits.map(r => r._source), ['org.login', 'name'])

    this.log('')
    this.log('All available repositories:')
    cli.table(esResults, {
      name: {
        get: row => (row.org.login + '/' + row.name)
      },
      active: {
        get: row => row.active
      },
    }, {
      printLine: this.log,
    })
    this.log('')
    const configArray = esResults.map(repo => {
      return {
        [repo.org.login + '/' + repo.name]: repo.active
      }
    })
    fs.writeFileSync(path.join(this.config.configDir, 'repositories.yml'), jsYaml.safeDump(configArray))
    cli.action.stop(' done')
    this.log('You can enable/disable repositories in: ' + path.join(this.config.configDir, 'repositories.yml'))
  }
}
