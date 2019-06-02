import gql from 'graphql-tag'

async function sleep(ms: number) {
  //https://github.com/Microsoft/tslint-microsoft-contrib/issues/355
  // tslint:disable-next-line no-string-based-set-timeout
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function graphqlQuery(client: any, query: any, variables: any, rateLimit: any, log: any) {
  log('Remaining GitHub tokens: ' + rateLimit.remaining)
  // Logic to pause if remaining ratelimit is lower than 50
  if (rateLimit.remaining - rateLimit.cost < 50 && rateLimit.resetAt !== null) {
    log('No token available, will resuming querying after ' + rateLimit.resetAt)
    const sleepDuration = (new Date(rateLimit.resetAt).getTime() - new Date().getTime()) / 1000
    log('Will resume querying in: ' + sleepDuration + 's')
    await sleep(sleepDuration + 10000)
    log('Ready to resume querying')
  }

  const data = await client.query({
    query: gql`${query}`,
    variables,
    fetchPolicy: 'no-cache',
    errorPolicy: 'ignore',
  })

  if (data.data !== undefined && data.data.errors !== undefined && data.data.errors.length > 0) {
    data.data.errors.forEach((error: {message: string}) => {
      log(error.message)
    })
  }

  return data
}
export default graphqlQuery
