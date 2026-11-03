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
const addBorrowsBook = db.collection("borrows");

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

app.get("/my-books/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await addBookCollection.find({ userId }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong" });
  }
});
app.put("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Book not found" });
    }

    const data = req.body;

    // Only allow known book fields to be updated
    const allowedFields = [
      "title",
      "author",
      "category",
      "description",
      "image",
      "publishYear",
    ];

    const update = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        update[field] = data[field];
      }
    }

    const result = await addBookCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: update },
      { returnDocument: "after" },
    );

    if (!result) {
      return res.status(404).send({ message: "Book not found" });
    }

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong" });
  }
});

app.delete("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Book not found" });
    }

    const result = await addBookCollection.findOneAndDelete({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({ message: "Book not found" });
    }

    res.send({ message: "Book deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong" });
  }
});


app.post("/borrows", async (req, res) => {
  try {
    const data = req.body;

    // Check if this user already borrowed this book
    const alreadyBorrowed = await addBorrowsBook.findOne({
      bookId: data.bookId,
      userEmail: data.userEmail,
    });

    if (alreadyBorrowed) {
      return res.status(409).send({
        message: "You have already borrowed this book!",
      });
    }

    const result = await addBorrowsBook.insertOne(data);

    res.status(201).send({
      message: "Book borrowed successfully!",
      result,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

app.get("/borrows", async (req, res) => {
  try {
    const { email } = req.query;

    const result = await addBorrowsBook.find({ userEmail: email }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Something went wrong" });
  }
});

app.get("/new-arrivals", async (req, res) => {
  const books = await addBookCollection
    .find()
    .sort({ _id: -1 })
    .limit(6)
    .toArray();

  res.send(books);
});

//http://localhost:8000

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
