# Imported from: https://github.com/oclif/docker/blob/master/Dockerfile
FROM node:10.9.0

MAINTAINER Francois Gerthoffert

RUN npm install -g github-indexer --save

CMD ["/bin/bash"]
