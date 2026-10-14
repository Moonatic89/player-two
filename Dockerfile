FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
CMD ["node","server.mjs"]
