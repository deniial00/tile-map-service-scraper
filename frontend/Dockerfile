FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY yarn.lock ./
RUN yarn install

COPY . .

RUN yarn build

CMD ["yarn", "dev", "--host", "0.0.0.0"] 