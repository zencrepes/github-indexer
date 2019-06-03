# Imported from: https://github.com/oclif/docker/blob/master/Dockerfile
FROM node:10.9.0

MAINTAINER Jeff Dickey

RUN apt-get -y update && \
  apt-get install -y --no-install-recommends \
    apt-utils \
    python-dev \
    p7zip-full \
  && \
  curl https://bootstrap.pypa.io/get-pip.py | python && \
  pip install awscli --upgrade && \
  aws configure set preview.cloudfront true && \
  apt-get remove -y python-dev && \
  apt-get clean && apt-get -y autoremove && \
  rm -rf \
    /var/lib/apt/lists/* \
    ~/.cache/*

CMD bash

