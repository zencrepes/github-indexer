//import {ApiResponse, Client} from '@elastic/elasticsearch'
import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import FetchAffiliated from '../utils/github/fetchAffiliated/index'
import FetchOrg from '../utils/github/fetchOrg/index'
import FetchRepo from '../utils/github/fetchRepo/index'

export default class GithubRepo extends Command {
  static description = 'Fetch repositories from GitHub'

  static examples = [
    '$ github-indexer es-schema -i issues',
  ]

  static flags = {
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
    force: flags.boolean({char: 'f', default: false}),
  }

  static args = [{name: 'file'}]

  async run() {
    const {flags} = this.parse(GithubRepo)
    const {grab, org, repo} = flags
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))

    let fetchedRepos = []
    if (grab === 'affiliated') {
      this.log('Starting to fetch data from affiliated organizations')
      const fetchData = new FetchAffiliated(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load()
      //Return all repos as a big array

    } else if (grab === 'org' && org !== undefined) {
      this.log('Starting to fetch data from org: ' + org)
      const fetchData = new FetchOrg(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load(org)
    } else if (grab === 'repo' && org !== undefined && repo !== undefined) {
      this.log('Starting to fetch data from repo: ' + org + '/' + repo)
      const fetchData = new FetchRepo(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load(org, repo)
    }
    this.log(fetchedRepos)
  }
/*
    // Force the user either to manually press y or to specify the force flag in the command line
    let proceed = true
    if (!force) {
      const userForce = await cli.prompt('Are you sure you want to push a new index ? It will ERASE your data (y/n)')
      proceed = (userForce === 'y')
    } else {
      proceed = true
    }
    if (proceed) {
      this.log('Testing connection to the Elasticsearch cluster')
      // tslint:disable-next-line:no-http-string
      const client = new Client({node: 'http://' + host + ':' + port})
      const healthCheck: ApiResponse = await client.cluster.health()

      if (healthCheck.body.status === 'red') {
        //https://nodejs.org/api/process.html#process_exit_codes
        this.log('Elastic search cluster is not in an healthy state, exiting')
        this.log(healthCheck.body)
        process.exit(1)
      }

      this.log('Testing for availability of index: ' + index)
      const testIndex = await client.indices.exists({index})
      if (testIndex.body !== false) {
        this.log('Index already exists, deleting')
        await client.indices.delete({index})
      }

      this.log('Loading the mapping from file ./src/schemas/' + mapping + '.yml')
      const mappings = await loadYamlFile('./src/schemas/' + mapping + '.yml')
      this.log('Schema configuration loaded')

      this.log('Loading the settings from file ./src/schemas/settings.yml')
      const settings = await loadYamlFile('./src/schemas/settings.yml')
      this.log(JSON.stringify(settings))

      this.log('Index settings loaded')

      this.log('Creating the index: ' + index)
      await client.indices.create({index, body: {settings, mappings}})
      this.log('Index created: ' + index)
    } else {
      this.log('Command cancelled')
    }
  */
}
