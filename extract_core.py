import json
import os

transcript_path = r'C:\Users\samue\.claude\projects\c--Users-samue-Coding-Sleeve-App\8b7ccc63-8b47-4abe-81a4-73ef997ac2f2.jsonl'
target_file = 'find-music-core.js'
output_path = r'C:\Users\samue\Coding\Sleeve-App\src\features\find-music\find-music-core.js'

# Create directory if it doesn't exist
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # The content of a Read tool result is usually in 'tool_result' or inside a message
            # Let's search for any string that looks like the content of the file
            # Search for specific functions we know should be in find-music-core.js
            content = str(data)
            if 'function cleanIsrc' in content or 'function similarity' in content:
                # Try to isolate the file content. 
                # Usually it's in data['tool_use_result']['stdout'] or similar
                # Since we don't know the exact JSON structure of the old session's logs,
                # we'll look for the largest contiguous block of JS code.
                import re
                # Look for the pattern where a file is read
                # "1\t'use strict';\n2\t..."
                match = re.search(r'(\d+\t\'use strict\'.*?)\n\s*\}\s*module\.exports', content, re.DOTALL)
                if match:
                    raw_content = match.group(1)
                    # Remove line numbers
                    lines = raw_content.split('\n')
                    cleaned_lines = []
                    for l in lines:
                        if '\t' in l:
                            cleaned_lines.append(l.split('\t', 1)[1])
                        else:
                            cleaned_lines.append(l)
                    
                    with open(output_path, 'w', encoding='utf-8') as out:
                        out.write('\n'.join(cleaned_lines))
                    print(f"Successfully recovered {target_file} to {output_path}")
                    exit(0)
        except Exception as e:
            continue
print("Failed to recover file content.")
