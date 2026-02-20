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

app.post("/subscribe", express.json(), (req, res) => {
  const subscription = req.body;
  subscriptions.push(subscription);
  console.log("New subscription added");
  res.status(201).send("Subscribed");
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

app.get("/send", async (req, res) => {
  const payload = JSON.stringify({
    title: "Test Notification",
    body: "Push is working 🎉"
  });

  try {
    for (const sub of subscriptions) {
      await webpush.sendNotification(sub, payload);
    }

    res.send("Push sent!");
  } catch (err) {
    console.error("FULL PUSH ERROR:", err);
    res.status(500).send(err.message);
  }
});
});

app.post("/report", async (req, res) => {
  const { dailyTotal, weeklyTotal, dailyGoal, weeklyGoal } = req.body;

  try {
    for (const sub of subscriptions) {

      if (dailyGoal && dailyTotal >= dailyGoal && !sub.dailyNotified) {
        await webpush.sendNotification(sub, JSON.stringify({
          title: "🎉 Daily Goal Reached!",
          body: `You earned $${dailyTotal.toFixed(2)} today!`
        }));
        sub.dailyNotified = true;
      }

      if (weeklyGoal && weeklyTotal >= weeklyGoal && !sub.weeklyNotified) {
        await webpush.sendNotification(sub, JSON.stringify({
          title: "🏆 Weekly Goal Crushed!",
          body: `Weekly total: $${weeklyTotal.toFixed(2)}`
        }));
        sub.weeklyNotified = true;
      }
    }

    res.send("Push checked");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error sending push");
  }
});

/* ============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
