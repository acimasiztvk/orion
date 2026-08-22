import { generateContentWithRetry, toolDeclarations, buildOrionSystemInstruction } from "../server/gemini.js";

async function test() {
  const user = { id: "test_user_1", name: "Alex Mercer", has_completed_onboarding: false };
  const systemInstruction = buildOrionSystemInstruction(user, [], true);

  const contents: any[] = [
    { role: "user", parts: [{ text: "Hello ORION, I just logged in for the first time." }] }
  ];

  const firstResponse = await generateContentWithRetry({
    primaryModel: "gemini-3.7-flash",
    fallbackModel: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: toolDeclarations }]
    }
  });

  console.log("First Response functionCalls:", firstResponse.functionCalls);
  console.log("First Response candidate content:", JSON.stringify(firstResponse.candidates?.[0]?.content, null, 2));

  // Now test proper functionResponse turns
  if (firstResponse.functionCalls) {
    const modelTurn = firstResponse.candidates?.[0]?.content;
    const toolResponsesParts = firstResponse.functionCalls.map((fc: any) => ({
      functionResponse: {
        name: fc.name,
        response: { success: true, message: `Saved ${fc.name}` }
      }
    }));

    const toolTurn = {
      role: "tool",
      parts: toolResponsesParts
    };

    const multiTurnContents = [
      ...contents,
      modelTurn,
      toolTurn
    ];

    console.log("\nSending proper multi-turn tool response to Gemini...");
    try {
      const secondResponse = await generateContentWithRetry({
        primaryModel: "gemini-3.7-flash",
        fallbackModel: "gemini-2.5-flash",
        contents: multiTurnContents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }]
        }
      });
      console.log("SUCCESS! Second Response Text:\n", secondResponse.text);
    } catch (err: any) {
      console.error("Second Response FAILED with error:", err.message);
    }
  }
}

test().catch(console.error);
