const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());
const stripe = require("stripe")(process.env.STRIPE_API);
const { v4: uuidv4 } = require("uuid");
var admin = require("firebase-admin");
var serviceAccount = require("./zapshiftfirebaseadminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// taracking id genarator
function generateTrackingId() {
  return `TRK-${uuidv4()}`;
}

// middleware
const verifyFbToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    res.status(401).send({ message: "unauthorizes access" });
    return;
  }
  try {
    const tokenId = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(tokenId);
    req.decodedEmail = decoded.email;
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = `mongodb+srv://admin:${process.env.DB_PASS}@cluster1.gq2vs5u.mongodb.net/?appName=Cluster1`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("zapShift");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const ridersCollectin = db.collection("riders");

    // middle ware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedEmail;
      const result = await usersCollection.findOne({ email: email });
      if (!result || result.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users api
    app.get("/users/:email/role", async (req, res) => {
      const result = await usersCollection.findOne({ email: req.params.email });
      res.send({ role: result?.role || "user" });
    });

    app.patch("/users", verifyFbToken, verifyAdmin, async (req, res) => {
      const { role, id } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            role: role,
          },
        }
      );
      res.send(result);
    });

    app.get("/users", verifyFbToken, async (req, res) => {
      const search = req.query.search;
      const query = {};
      if (search) {
        query.displayName = { $regex: search, $options: "i" };
      }
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      const check = await usersCollection.findOne({ email: user.email });
      if (check) {
        return res.send("message:user already exixts ");
      }
      user.role = "user";
      user.createdAt = new Date();

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // riders api

    app.post("/riders", verifyFbToken, async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();
      const result = await ridersCollectin.insertOne(rider);
      res.send(result);
    });

    app.get("/riders", async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {};
      if (district) {
        query.district = district;
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }
      if (status) {
        query.status = req.query.status;
      }
      const result = await ridersCollectin.find(query).toArray();
      res.send(result);
    });

    app.patch("/riders/:id", verifyFbToken, verifyAdmin, async (req, res) => {
      const updatedDoc = {
        $set: {
          status: req.body.status,
          workStatus: "available",
        },
      };
      const result = await ridersCollectin.updateOne({ _id: new ObjectId(req.params.id) }, updatedDoc);
      res.send(result);
      if (req.body.status === "approved") {
        const changeRole = await usersCollection.updateOne(
          { email: req.body.email },
          {
            $set: {
              role: "rider",
            },
          }
        );
      }
    });

    // parcel api

    app.get("/assign-parcels", async (req, res) => {
      const parcels = await parcelCollection.find({ deliveryStatus: "pending-pickup", paymentStatus: "paid" }).toArray();

      res.send(parcels);
    });

    app.get("/parcels", verifyFbToken, async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
        if (email !== req.decodedEmail) {
          return res.status(401).send({ message: "Forbidden access" });
        }
      }
      const result = await parcelCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const resut = await parcelCollection.insertOne(parcel);
      res.send(resut);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      const result = await parcelCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    app.patch("/percels/:id", async (req, res) => {
      const { riderId, riderEmail, riderName, percelId } = req.body;
      const updatedDoc = {
        $set: {
          deliveryStatus: "driver-assigned",
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail,
        },
      };
      const result = await parcelCollection.updateOne({ _id: new ObjectId(req.params.id) }, updatedDoc);
      // update rider
      const riderUpdate = await ridersCollectin.updateOne(
        { _id: new ObjectId(riderId) },
        {
          $set: {
            workStatus: "in-transit",
          },
        }
      );
      console.log(riderUpdate);
      res.send(riderUpdate);
    });

    // STRIPE Api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: { name: paymentInfo.parcelName },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,

        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionid = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionid);
      const check = await paymentCollection.findOne({ tnxId: session.payment_intent });
      if (check) {
        res.send({ mesasge: "payment already done" });
        return;
      }
      const trackingId = generateTrackingId();
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "pending-pickup",
            trackingId: trackingId,
          },
        };
        const result = await parcelCollection.updateOne({ _id: new ObjectId(id) }, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          tnxId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({ success: "true", trackingId: trackingId, tnxId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment });
        }
      } else {
        res.send({ failed: true });
      }
    });

    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const result = await paymentCollection.find(query).sort({ paidAt: -1 }).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
