# Marketplace-v2-API

## Name

Marketplace-v2 API development.

## Description



## Installation

Clone repository, then install dependencies with:

```bash
npm i
```

### Local NodeJS

Create a `.env` file in the root project directory that looks like this, or set these environment variables:

```bash
MONGODB_CONNECTION_STRING=mongodb+srv://{DB_USER}:{DB_PASSWORD}@{DB_HOST_ADDRESS}
MONGODB_DEALERS_DB=name_of_database
MONGODB_DEALERS_COLLECTION=name_of_collection
MONGODB_LENDERS_DB=name_of_database
MONGODB_LENDER_COLLECTION=name_of_collection
MONGODB_GROUPS_DB=name_of_database
MONGODB_GROUPS_COLLECTION=name_of_collection
MONGODB_INVENTORY_DB=name_of_database
MONGODB_INVENTORY_COLLECTION_CA=name_of_collection
MONGODB_INVENTORY_COLLECTION_US=name_of_collection
MONGODB_AGENTS_DB=name_of_database
MONGODB_AGENTS_COLLECTION=name_of_collection

SMTP_HOST=smtp.email.com
SMTP_PORT=587 # use port for TLS
SMTP_USER=user@email.com
SMTP_PASS=***********************

BASE_PORT=3000
BASE_URL=http://localhost:3000 # Port should match port above, unless standard HTTP/HTTPS.
BASE_GUI_URL=''
SUPPORT_URL=''

SERVERLESS=0
```

Compile and run with:

```bash
npm start
```

### Serverless.com

Make sure you have the `serverless` CLI tool from serverless.com installed and configured correctly with AWS credentials.

Create a `serverless-dev.yml` or `serverless-prod.yml` file in the root project directory that looks like this:

```yaml
service: 

plugins:
  - serverless-offline
provider:
  name: aws
  runtime: nodejs18.x
  stage: dev
  region: us-east-1
  timeout: 15
  apiGateway:
    minimumCompressionSize: 1024
  environment:
    MONGODB_CONNECTION_STRING: mongodb+srv://{DB_USER}:{DB_PASSWORD}@{DB_HOST_ADDRESS}
    MONGODB_DEALERS_DB: name_of_database
    MONGODB_DEALERS_COLLECTION: name_of_collection
    MONGODB_DEALERS_DB: name_of_database
    MONGODB_DEALERS_COLLECTION: name_of_collection
    MONGODB_LENDERS_DB: name_of_database
    MONGODB_LENDER_COLLECTION: name_of_collection
    MONGODB_GROUPS_DB: name_of_database
    MONGODB_GROUPS_COLLECTION: name_of_collection
    MONGODB_INVENTORY_DB: name_of_database
    MONGODB_INVENTORY_COLLECTION_CA: name_of_collection
    MONGODB_INVENTORY_COLLECTION_US: name_of_collection
    MONGODB_AGENTS_DB: name_of_database
    MONGODB_AGENTS_COLLECTION: name_of_collection
    SMTP_HOST: "smtp.email.com"
    SMTP_PORT: 587 # use port for TLS
    SMTP_USER: "user@email.com"
    SMTP_PASS: "***********************"
    BASE_URL: "" # The base URL of the serverless function, may need to deploy twice at first to get this.
    BASE_GUI_URL: ''
    SUPPORT_URL: ''

functions:
  app:
    handler: dist/index.handler
    events:
      - http: ANY /
      - http: "ANY /{proxy+}"
```

Compile and run locally with:

```bash
npm run deploy-local
```

Compile and deploy to serverless.com with :

Dev:

```bash
npm run deploy-dev
```

Prod:

```bash
npm run deploy-prod
```

## Usage

These are the endpoints:

- /new-dealer

---

## Authors and acknowledgment


## Project status

In Development.
