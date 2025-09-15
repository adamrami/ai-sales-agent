// This file acts as a secure proxy to the Gemini API, hiding your API key.
// It should be deployed to a service like Vercel.

// The API key is stored securely as an environment variable.
const apiKey = process.env.GEMINI_API_KEY; 

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt } = req.body;
        
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            "tone": { "type": "STRING" },
                            "subject": { "type": "STRING" },
                            "body": { "type": "STRING" }
                        },
                        "propertyOrdering": ["tone", "subject", "body"]
                    }
                }
            }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Error in API proxy:', error);
        res.status(500).json({ error: error.message });
    }
}
