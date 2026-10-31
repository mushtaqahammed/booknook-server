import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = 8000;

const client = new MongoClient(process.env.MONGODB_URL);

app.use(cors());
app.use(express.json());

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");
const addBookCollection = db.collection("addbook");

app.get("/", (req, res) => {
  res.send({ message: "Server is running fine!" });
});

app.post("/add-book", async (req, res) => {
  const data = req.body;
  const result = await addBookCollection.insertOne(data);
  res.send({ result });
});
app.get("/books", async (req, res) => {
  const result = await addBookCollection.find().toArray();
  res.send(result);
});

app.get("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await addBookCollection.findOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong" });
  }
});
//http://localhost:8000

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
