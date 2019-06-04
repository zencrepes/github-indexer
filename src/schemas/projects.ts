const yaml = `
#https://www.elastic.co/guide/en/elasticsearch/plugins/current/mapper-size-usage.html
_source:
  enabled: true
properties:
  # Core properties of the entity
  id:
    type: keyword
  createdAt:
    type: date
  updatedAt:
    type: date
  closedAt:
    type: date
  name:
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
  columns:
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
              cards:
                properties:
                  totalCount:
                    type: integer
  pendingCards:
    properties:
      totalCount:
        type: integer
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
`
export default yaml
