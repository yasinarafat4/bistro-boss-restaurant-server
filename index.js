const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");
const cors = require("cors");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT middleware
const verifyJWT = (req, res, next) => {
  // console.log("Hitting verify jwt");
  // console.log(req.headers.authorization);
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized Access" });
  }
  // Bearer token
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "Unauthorized Access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qx5eerd.mongodb.net/?retryWrites=true&w=majority`;
// const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-tguiqde-shard-00-00.qx5eerd.mongodb.net:27017,ac-tguiqde-shard-00-01.qx5eerd.mongodb.net:27017,ac-tguiqde-shard-00-02.qx5eerd.mongodb.net:27017/?ssl=true&replicaSet=atlas-6rcg7x-shard-0&authSource=admin&retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    // await client.connect();

    // DB collections
    const usersCollection = client.db("bistroBossDB").collection("users");
    const menuCollection = client.db("bistroBossDB").collection("menu");
    const reviewsCollection = client.db("bistroBossDB").collection("reviews");
    const cartCollection = client.db("bistroBossDB").collection("carts");
    const paymentCollection = client.db("bistroBossDB").collection("payments"); // to store payments

    // JWT related API's
    app.post("/jwt", (req, res) => {
      const user = req.body;
      console.log(user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Admin verify middleware (use verifyAdmin after using verifyJWT)
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ error: true, message: "Forbidden" });
      }
      next();
    };

    // Users related API's

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // create(POST)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      console.log(existingUser);
      if (existingUser) {
        return res.send({ message: "User already exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // To check user admin or not
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // To make admin (PATCH)
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Delete
    app.delete("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // Menu related API's
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    // creating POST API for Image url
    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    });

    // Delate menu
    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // Reviews related API's
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });

    // Cart related API's
    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;
      console.log(email);
      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (decodedEmail !== email) {
        return res.status(403).send({ error: 1, message: "Forbidden Access" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // Insert
    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    // Delete
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Payment related API's

    // create payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Storing payments
    app.post("/payments", verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      // Delete query
      const query = {
        _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) },
      };
      const deleteResult = await cartCollection.deleteMany(query);

      // send an email to confirm payment
      sendPaymentConfirmationEmail(payment);

      res.send({ insertResult, deleteResult });
    });

    // send payment confirmation email
    // let transporter = nodemailer.createTransport({
    //   host: "smtp.sendgrid.net",
    //   port: 587,
    //   auth: {
    //     user: "apikey",
    //     pass: process.env.SENDGRID_API_KEY,
    //   },
    // });

    const auth = {
      auth: {
        api_key: process.env.EMAIL_PRIVATE_KEY,
        domain: process.env.EMAIL_DOMAIN,
      },
    };

    const transporter = nodemailer.createTransport(mg(auth));

    const sendPaymentConfirmationEmail = (payment) => {
      transporter.sendMail(
        {
          from: "mdyasinarafathasib@gmail.com",
          to: "mdyasinarafathasib@gmail.com",
          subject: "Your order is confirmed. Enjoy the food!",
          text: "Hello world!",
          html: `<div>
          <h2>Payment Confirmed!</h2>
            <p>Transaction Id: ${payment.transactionId}</p>
          </div>`,
        },
        function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        }
      );
    };

    // Admin dashboard stats related API's
    app.get("/admin-stats", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // best way to get sum of the price field is to use group and sum
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce((sum, payment) => sum + payment.price, 0);

      res.send({
        users,
        products,
        orders,
        revenue,
      });
    });

    // Showing different data in Admin Home API

    /*
    Second Best Solution

    1. load all payments
    2. for each payment, get the menuItems array
    3. for each item in the menuItems array get the menuItem from the menu collection
    4. put them in an array: allOrderedItems
    5. separate allOrderItems by category using filter
    6. now get the quantity by using length: desserts.length
    7. for each category use reduce to get the total amount spent on this category
    */

    // Best solution by aggregate pipeline

    app.get("/order-stats", verifyJWT, verifyAdmin, async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: "menu",
            localField: "menuItems",
            foreignField: "_id",
            as: "menuItemsData",
          },
        },
        {
          $unwind: "$menuItemsData",
        },
        {
          $group: {
            _id: "$menuItemsData.category",
            count: { $sum: 1 },
            total: { $sum: "$menuItemsData.price" },
          },
        },
        {
          $project: {
            category: "$_id",
            count: 1,
            total: { $round: ["$total", 2] },
            _id: 0,
          },
        },
      ];
      const result = await paymentCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro Boss is Running");
});

app.listen(port, () => {
  console.log(`Bistro Boss is Running on Port ${port}`);
});

/*
--------------------
  Naming Convention
--------------------

users: usersCollection

app.get('/users')
app.get('/users/:id')
app.post('/users')
app.patch('/users/:id')
app.put('/users/:id')
app.delete('/users/:id')

*/
