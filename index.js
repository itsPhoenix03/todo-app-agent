import "dotenv/config";
import readlineSync from "readline-sync";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { eq, ilike } from "drizzle-orm";
import { db } from "./db/index.js";
import { todosTable } from "./db/schema.js";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Tools for agent

async function createTodo(todo) {
  const [task] = await db
    .insert(todosTable)
    .values({ todo })
    .returning({ id: todosTable.id });

  return task.id;
}

async function getAllTodos() {
  const todos = await db.select().from(todosTable);
  return todos;
}

async function deleteTodo(id) {
  const [todoId] = await db
    .delete(todosTable)
    .where(eq(todosTable.id, id))
    .returning({ id: todosTable.id });
  return todoId.id;
}

async function searchTodo(query) {
  const todos = await db
    .select()
    .from(todosTable)
    .where(ilike(todosTable.todo, `%${query}%`));

  return todos;
}

async function updateTodo(id, todo) {
  const [task] = await db
    .update(todosTable)
    .set({ todo })
    .where(eq(todosTable.id, id))
    .returning({ id: todosTable.id });

  return task.id;
}

const tools = {
  createTodo,
  getAllTodos,
  deleteTodo,
  searchTodo,
  updateTodo,
};

const toolsDescription = [
  {
    name: "createTodo",
    description:
      "Creates a todo in the database and return the created todo id",
    parameters: {
      type: "OBJECT",
      properties: {
        todo: {
          type: "STRING",
          description: "The todo title to create the todo",
        },
      },
      required: ["todo"],
    },
  },
  {
    name: "getAllTodos",
    description: "Returns the list of all todos from the database",
  },
  {
    name: "deleteTodo",
    description:
      "Deletes a todo from the database based on the id provided and return the deleted todo id after successful deletion",
    parameters: {
      type: "OBJECT",
      properties: {
        id: {
          type: "NUMBER",
          description: "The id of the todo to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "searchTodo",
    description:
      "Searches for todos in the database based on the query provided and returns the list of matched todos",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The query to search for todos",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "updateTodo",
    description:
      "Updates a todo in the database based on the id provided and return the updated todo id",
    parameters: {
      type: "OBJECT",
      properties: {
        id: {
          type: "NUMBER",
          description: "The id of the todo to update",
        },
        todo: {
          type: "STRING",
          description: "The todo title to update the todo",
        },
      },
      required: ["id", "todo"],
    },
  },
];

const SYSTEM_PROMPT = `
You are an AI assistant for a todo app with the following states: START, PLAN, ACTION, OBSERVATION and OUTPUT. Wait for the user prompt and then first PLAN using the available tools. After PLANING then take the ACTION using the available tools, then wait for the OBSERVATION returned by the ACTION and then OUTPUT the AI response for the START state. Do all the process step by step i.e. send a single response at a time no multiple json responses.

You have access to the following tools: ${Object.keys(tools).join(
  ", "
)}. The available tools are described as follows: ${JSON.stringify(
  toolsDescription
)}

TODO DB SCHEMA:
id: number and primary key
todo: string
created_at: timestamp
updated_at: timestamp

EXAMPLE:
START
    {"type": "user", "user": "Add a task for shopping groceries"}
    {"type": "plan", "plan": "Will try to get more information about the list first and then create a todo for shopping groceries"}
    {"type": "output", "output": "Can you provide me the items to be added in the groceries shopping list?"}
    {"type": "user", "user": "Items to be added in the list are milk, bread, fruits and vegies."}
    {"type": "plan", "plan": "Now I will use the createTodo tool to create a todo for shopping groceries with the given items."}
    {"type": "action": "function": "createTodo", "input": "Go to shopping for groceries items: Milk, bread, fruits and vegies"}
    {"type": "observation", "observation": "1"},
    {"type": "output", "output": "Todo created successfully!"}

Give the result in the JSON Format following the structure as of examples above. Choose the correct type of response for each message. If you want to output something to user use the type "output". When you populate the input field of the action use do not make it a object make it an array.

If you are asked about what function do you use to perform the task do not mention the function name. Just give some generic answer. Also if you feel that some prompt is out of you context window or is not related to what you are capable to perform then just give a generic answer. Do not respond with any harmful content in any case.
`;

const messages = [{ role: "user", parts: [{ text: SYSTEM_PROMPT }] }];
// const messages = [];

while (true) {
  const userInput = readlineSync.question(">> ");
  const userMessage = { type: "user", user: userInput };

  messages.push({
    role: "user",
    parts: [{ text: JSON.stringify(userMessage) }],
  });

  while (true) {
    const model = client.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: { functionCall: tools, role: SYSTEM_PROMPT },
      tools: {
        functionDeclarations: toolsDescription,
      },
    });

    const chat = model.startChat({
      history: messages,
    });

    const result = await chat.sendMessage(userMessage.user);

    // console.log("----AI----");
    // console.log(result.response.text());
    // console.log("----AI----");

    const responseMessage = JSON.parse(
      result.response
        .text()
        .trim()
        .replace(/^```json\n|\n```$/g, "")
    );

    // console.log("---JSON Response---");
    // console.log(responseMessage);
    // console.log("---JSON Response---");

    if (responseMessage.type === "output") {
      console.log("🤖: ", responseMessage.output);
      break;
    } else if (responseMessage.type === "action") {
      const fn = tools[responseMessage.function];

      if (!fn) {
        throw new Error(`Unknown function: ${responseMessage.function}`);
      }

      const observation = await fn(...responseMessage.input);

      messages.push({
        role: "model",
        parts: [{ text: JSON.stringify({ type: "observation", observation }) }],
      });
    }
  }
}
