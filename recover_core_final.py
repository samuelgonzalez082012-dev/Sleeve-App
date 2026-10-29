import json
import os

transcript_path = r'C:\Users\samue\.claude\projects\c--Users-samue-Coding-Sleeve-App\8b7ccc63-8b47-4abe-81a4-73ef997ac2f2.jsonl'
output_path = r'C:\Users\samue\Coding\Sleeve-App\src\features\find-music\find-music-core.js'

os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # Check if this line is a tool result
            if 'tool_use_result' in data:
                result = data['tool_use_result']
                # The output of Read tool is usually in 'stdout'
                stdout = result.get('stdout', '')
                if 'find-music-core.js' in stdout or 'cleanIsrc' in stdout:
                    # Clean line numbers: "1\tcontent\n2\tcontent"
                    lines = stdout.split('\n')
                    cleaned = []
                    for l in lines:
                        if '\t' in l:
                            parts = l.split('\t', 1)
                            if parts[0].isdigit():
                                cleaned.append(parts[1])
                            else:
                                cleaned.append(l)
                        else:
                            cleaned.append(l)
                    
                    with open(output_path, 'w', encoding='utf-8') as out:
                        out.write('\n'.join(cleaned))
                    print("SUCCESS")
                    exit(0)
        except:
            continue
print("FAILURE")
