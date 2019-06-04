# Imported from: https://github.com/oclif/docker/blob/master/Dockerfile
FROM node:alpine

MAINTAINER Francois Gerthoffert

RUN npm install -g github-indexer@latest

CMD ["/bin/sh"]
