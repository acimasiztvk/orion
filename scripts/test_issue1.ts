import { createUser, getUserById, getUserProfileFacts } from "../server/db.js";
import { buildOrionSystemInstruction, generateContentWithRetry, toolDeclarations } from "../server/gemini.js";

async function main() {
  console.log("=== TESTING ISSUE 1: ONBOARDING FOR NEW USER ===");
  
  // 1. Create a brand new user
  const testEmail = `cadet_${Date.now()}@nexus.ai`;
  const testPassword = "QuantumPass123!";
  const testName = "Alex Mercer";
  
  const newUser = await createUser(testEmail, testPassword, testName);
  console.log("1. Created New User:", newUser);
  console.log("   has_completed_onboarding flag is:", newUser.has_completed_onboarding);

  // 2. Fetch fresh user from DB to verify persistence of flag
  const dbUser = await getUserById(newUser.id);
  console.log("2. DB verified User:", dbUser);
  console.log("   dbUser.has_completed_onboarding:", dbUser?.has_completed_onboarding);

  const isOnboarding = !dbUser?.has_completed_onboarding;
  console.log("3. isOnboarding boolean evaluated as:", isOnboarding);

  // 3. Build system instruction
  const profileFacts = await getUserProfileFacts(newUser.id);
  const systemInstruction = buildOrionSystemInstruction(dbUser!, profileFacts, isOnboarding);
  console.log("\n4. ACTUAL SYSTEM INSTRUCTION SENT TO GEMINI:\n----------------------------------------\n" + systemInstruction + "\n----------------------------------------\n");

  // 4. Send first user message
  const userFirstMessage = "Hello ORION, I just logged in for the first time.";
  console.log("5. Sending First User Message:", userFirstMessage);

  const contents = [
    { role: "user", parts: [{ text: userFirstMessage }] }
  ];

  const response = await generateContentWithRetry({
    primaryModel: "gemini-3.7-flash",
    fallbackModel: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: toolDeclarations }]
    }
  });

  console.log("6. ACTUAL RAW GEMINI RESPONSE:");
  console.log("   Text:", response.text);
  console.log("   Function Calls:", response.functionCalls);
  console.log("   Candidates count:", response.candidates?.length);
}

main().catch(console.error);
