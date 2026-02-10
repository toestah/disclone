FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install all dependencies
RUN npm install --omit=dev && \
    npm install --prefix server --omit=dev && \
    npm install --prefix client

# Copy source code
COPY server/ ./server/
COPY client/ ./client/

# Build the Vite client
RUN npm run build

# Clean up client dev dependencies and source after build
RUN rm -rf client/node_modules client/src client/vite.config.js client/eslint.config.js

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
