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
      pullRequests(first: $increment, after: $repo_cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
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
            title
            body
            state
            author {
              login
              avatarUrl
              url
            }
            labels (first: 10) {
              totalCount
              edges {
                node {
                  id
                  color
                  name
                  description
                }
              }
            }
            milestone {
              id
              createdAt
              updatedAt
              closedAt
              description
              dueOn
              issues (first: 1) {
                totalCount
              }
              number
              state
              title
              url
            }
            assignees(first: 4) {
              totalCount
              edges {
                node {
                  id
                  avatarUrl
                  login
                  name
                  url
                }
              }
            }
            comments(first: 1) {
              totalCount
            }
            participants(first: 1) {
              totalCount
            }
            reviewRequests(first: 1) {
              totalCount
            }
            reviews(first: 1) {
              totalCount
            }
            projectCards(first: 5) {
              totalCount
              edges {
                node {
                  id
                  project {
                    id
                    name
                  }
                  column {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`
export default query
