const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());
const stripe = require("stripe")(process.env.STRIPE_API);

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

    // parcel api

    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const result = await parcelCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      console.log(parcel);
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
      console.log(result);
      res.send(result);
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
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
      });
      res.send({ url: session.url });
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
