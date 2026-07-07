import 'dotenv/config'; // Loads your .env file

async function test() {
  console.log("Checking if key is loaded:", process.env.GEMINI_API_KEY ? "YES ✅" : "NO ❌ (Check your .env file!)");
  
  if (!process.env.GEMINI_API_KEY) return;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say hello in JSON format like {\"message\": \"hello\"}" }] }],
      }),
    }
  );

  if (!res.ok) {
    console.error("API Error:", res.status, await res.text());
    return;
  }

  const data = await res.json();
  console.log("Success! Gemini replied:", data.candidates[0].content.parts[0].text);
}

test();
