const query = `
  query ($repo_cursor: String, $increment: Int, $org_name: String!, $repo_name: String!){
    rateLimit {
      limit
      cost
      remaining
      resetAt
    }
    repository(owner:$org_name, name:$repo_name) {
      name
      url
      id
      databaseId
      projects(first: $increment, after: $repo_cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        edges {
          cursor
          node {
            id
            createdAt
            updatedAt
            closedAt
            databaseId
            number
            url
            name
            state
            body
            columns(first: 10) {
              totalCount
              edges {
                node {
                  id
                  name
                  cards(first: 1) {
                    totalCount
                  }
                }
              }
            }
            pendingCards(first: 100) {
              totalCount
            }
          }
        }
      }
    }
  }
`
export default query
