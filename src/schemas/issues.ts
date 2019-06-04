const yaml = `
#https://www.elastic.co/guide/en/elasticsearch/plugins/current/mapper-size-usage.html
_source:
  enabled: true
properties:
  # Core properties of the entity
  createdAt:
    type: date
  updatedAt:
    type: date
  closedAt:
    type: date
  title:
    type: text
  body:
    type: text
  url:
    type: keyword
  databaseId:
    type: integer
  number:
    type: integer
  state:
    type: keyword
  # Core items attached to the entity, each should relate to other entites available in the overall datamodel
  assignees:
    properties:
      totalCount:
        type: integer
      edges:
        type: nested
        properties:
          node:
            properties:
              id:
                type: keyword
              login:
                type: keyword
              name:
                type: text
                fields:
                  raw:
                    type: keyword
              url:
                type: keyword
              avatarUrl:
                type: keyword
  author:
    properties:
      id:
        type: keyword
      login:
        type: keyword
      name:
        type: text
        fields:
          raw:
            type: keyword
      url:
        type: keyword
      avatarUrl:
        type: keyword
  labels:
    properties:
      totalCount:
        type: integer
      edges:
        type: nested
        properties:
          node:
            properties:
              id:
                type: keyword
              color:
                type: keyword
              description:
                type: text
              name:
                type: text
                fields:
                  raw:
                    type: keyword
  org:
    properties:
      id:
        type: keyword
      login:
        type: keyword
      name:
        type: text
        fields:
          raw:
            type: keyword
      url:
        type: keyword
  repo:
    properties:
      id:
        type: keyword
      databaseId:
        type: integer
      diskUsage:
        type: integer
      forkCount:
        type: integer
      isArchived:
        type: boolean
      isPrivate:
        type: boolean
      name:
        type: text
        fields:
          raw:
            type: keyword
      url:
        type: keyword
      org:
        properties:
          id:
            type: keyword
          login:
            type: keyword
          name:
            type: text
            fields:
              raw:
                type: keyword
          url:
            type: keyword
      owner:
        properties:
          id:
            type: keyword
          login:
            type: keyword
          url:
            type: keyword
  projectCards:
    properties:
      totalCount:
        type: integer
      edges:
        type: nested
        properties:
          node:
            properties:
              id:
                type: keyword
              column:
                properties:
                  id:
                    type: keyword
                  name:
                    type: keyword
              project:
                properties:
                  id:
                    type: keyword
                  name:
                    type: keyword
                  url:
                    type: keyword
  pullRequests:
    properties:
      totalCount:
        type: integer
      edges:
        type: nested
        properties:
          node:
            properties:
              id:
                type: keyword
              number:
                type: integer
              state:
                type: keyword
              title:
                type: text
              url:
                type: keyword
  timelineItems:
    properties:
      totalCount:
        type: integer
      edges:
        type: nested
        properties:
          node:
            properties:
              id:
                type: keyword
              createdAt:
                type: date
              isCrossRepository:
                type: boolean
              referencedAt:
                type: date
              resourcePath:
                type: keyword
              url:
                type: keyword
              willCloseTarget:
                type: keyword
              source:
                properties:
                  __typename:
                    type: keyword
                  id:
                    type: keyword
                  number:
                    type: integer
                  state:
                    type: keyword
                  title:
                    type: text
                  url:
                    type: keyword
              target:
                properties:
                  __typename:
                    type: keyword
                  id:
                    type: keyword
                  number:
                    type: integer
                  state:
                    type: keyword
                  title:
                    type: text
                  url:
                    type: keyword
  # Properties used only for count
  comments:
    properties:
      totalCount:
        type: integer
  participants:
    properties:
      totalCount:
        type: integer
`
export default yaml
