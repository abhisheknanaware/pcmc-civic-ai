FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# pcmc.json (zones, departments) lives in the shared config folder at the repo root
COPY --from=config pcmc.json /config/pcmc.json
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "server.js"]
