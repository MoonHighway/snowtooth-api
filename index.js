import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import express from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import bodyParser from "body-parser";
import { GraphQLScalarType } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { PubSub } from "graphql-subscriptions";

import lifts from "./data/lifts.json" assert { type: "json" };
import trails from "./data/trails.json" assert { type: "json" };
import hotels from "./data/hotels.json" assert { type: "json" };
import events from "./data/events.json" assert { type: "json" };

import "dotenv/config";

const typeDefs = fs.readFileSync(
  "./typeDefs.graphql",
  "UTF-8"
);
const pubsub = new PubSub();
const resolvers = {
  Query: {
    allEvents: () => events,
    allHotels: () => hotels,
    allLifts: (parent, { status }) =>
      !status
        ? lifts
        : lifts.filter((lift) => lift.status === status),
    findLiftById: (parent, { id }) =>
      lifts.find((lift) => id === lift.id),
    liftCount: (parent, { status }) =>
      !status
        ? lifts.length
        : lifts.filter((lift) => lift.status === status)
            .length,
    allTrails: (parent, { status }) =>
      !status
        ? trails
        : trails.filter((trail) => trail.status === status),
    findTrailByName: (parent, { name }) =>
      trails.find((trail) => name === trail.name),
    trailCount: (parent, { status }) =>
      !status
        ? trails.length
        : trails.filter((trail) => trail.status === status)
            .length
  },
  Mutation: {
    setLiftStatus: (parent, { id, status }) => {
      let updatedLift = lifts.find(
        (lift) => id === lift.id
      );
      updatedLift.status = status;
      pubsub.publish("lift-status-change", {
        liftStatusChange: updatedLift
      });
      return updatedLift;
    },
    setTrailStatus: (parent, { id, status }) => {
      let updatedTrail = trails.find(
        (trail) => id === trail.id
      );
      updatedTrail.status = status;
      pubsub.publish("trail-status-change", {
        trailStatusChange: updatedTrail
      });
      return updatedTrail;
    }
  },
  Lift: {
    trailAccess: (parent) =>
      parent.trails.map((id) =>
        trails.find((t) => id === t.id)
      )
  },
  Trail: {
    accessedByLifts: (parent) =>
      parent.lift.map((id) =>
        lifts.find((l) => id === l.id)
      )
  },
  Date: new GraphQLScalarType({
    name: "DateTime",
    description: "A valid date time value.",
    parseValue: (value) => new Date(value),
    serialize: (value) =>
      new Date(value).toLocaleDateString("en-us", {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric"
      }),
    parseLiteral: (ast) => new Date(ast.value)
  }),
  Subscription: {
    liftStatusChange: {
      subscribe: (parent, data) =>
        pubsub.asyncIterator("lift-status-change")
    },
    trailStatusChange: {
      subscribe: (parent, data) =>
        pubsub.asyncIterator("trail-status-change")
    }
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

const app = express();
const httpServer = http.createServer(app);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/"
});

const serverCleanup = useServer({ schema }, wsServer);

const server = new ApolloServer({
  schema,
  context: { pubsub },
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          }
        };
      }
    }
  ]
});

await server.start();
app.use(
  "/",
  cors(),
  bodyParser.json(),
  expressMiddleware(server)
);

const PORT = 3000;
// Now that our HTTP server is fully set up, we can listen to it.
httpServer.listen(PORT, () => {
  console.log(
    `Server is now running on http://localhost:${PORT}`
  );
});
