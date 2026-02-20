const express = require("express");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

/* =============================
   🔑 PUT YOUR VAPID KEYS HERE
   ============================= */

const PUBLIC_KEY = "BBADKU0IPBOYmK64JDH0pOsQ25BTNiOUVzvA0xXwyISS61HRaWlF4AeAma5zAZp9Ov7muPHzYIZcgdIhU6NFNZk";
const PRIVATE_KEY = "kON1aHt9iWNuzvDb-zLQ7g6HBSh9Uaxxmzje89kMSd0";

webpush.setVapidDetails(
  "mailto:your@email.com",
  PUBLIC_KEY,
  PRIVATE_KEY
);

let subscriptions = [];

/* =============================
   Save Subscription
   ============================= */

app.post("/subscribe", (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({});
});

/* =============================
   Send Push Notification
   ============================= */

app.post("/send", async (req, res) => {
  const payload = JSON.stringify({
    title: "🎉 Goal Reached!",
    body: "You crushed your goal!"
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      console.error(err);
    }
  }

  res.status(200).json({ success: true });
});

/* ============================= */

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});