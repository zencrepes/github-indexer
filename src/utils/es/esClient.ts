//https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/auth-reference.html
import {Client} from '@elastic/elasticsearch'
import * as fs from 'fs'

interface Configuration {
  es_node: string | undefined,
  es_ssl_ca: string | undefined,
  es_cloud_id: string | undefined,
  es_cloud_username: string | undefined,
  es_cloud_password: string | undefined,
}

function esClient(p: Configuration) {
  const {es_node, es_ssl_ca, es_cloud_id, es_cloud_username, es_cloud_password} = p

  if (es_cloud_id !== undefined && es_cloud_id !== null && es_cloud_username !== undefined && es_cloud_username !== null && es_cloud_password !== undefined && es_cloud_password !== null) {
    return new Client({
      cloud: {
        id: es_cloud_id,
        username: es_cloud_username,
        password: es_cloud_password
      }
    })
  } else if (es_ssl_ca !== undefined && es_ssl_ca !== null) {
    return new Client({
      node: es_node,
      ssl: {
        ca: fs.readFileSync(es_ssl_ca)
      }
    })
  } else {
    return new Client({
      node: es_node
    })
  }

}
export default esClient
