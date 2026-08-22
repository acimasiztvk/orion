import { generateContentWithRetry, toolDeclarations, executeToolCall, buildOrionSystemInstruction } from "../server/gemini.js";

async function main() {
  console.log("=== TESTING ISSUE 2: 'OPEN YOUTUBE' TOOL CALL ===");
  
  const testUser = {
    id: "user_test_tools",
    name: "Alex Mercer",
    has_completed_onboarding: true
  };

  const systemInstruction = buildOrionSystemInstruction(testUser, [], false);
  const userCommand = "open YouTube";
  console.log("1. User Spoken/Typed Command:", userCommand);

  const contents = [
    { role: "user", parts: [{ text: userCommand }] }
  ];

  console.log("2. Registered Tools sent with request:");
  console.log(toolDeclarations.map(t => ({ name: t.name, description: t.description })));

  const response = await generateContentWithRetry({
    primaryModel: "gemini-3.7-flash",
    fallbackModel: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: toolDeclarations }]
    }
  });

  console.log("\n3. ACTUAL GEMINI RESPONSE:");
  console.log("   Text reply:", response.text);
  console.log("   Function Calls:", JSON.stringify(response.functionCalls, null, 2));

  if (response.functionCalls && response.functionCalls.length > 0) {
    for (const call of response.functionCalls) {
      console.log(`\n4. Executing tool '${call.name}' with args:`, call.args);
      const executionResult = await executeToolCall(call.name, call.args, testUser.id);
      console.log("   Tool Execution Output:", executionResult);
    }
  } else {
    console.log("   NO FUNCTION CALL WAS TRIGGERED!");
  }
}

main().catch(console.error);
