# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 零依赖：只拷运行时需要的文件，不装任何 npm 包
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY scripts ./scripts

# 非 root 运行
RUN addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app
USER app

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
