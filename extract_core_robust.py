import json
import os

transcript_path = r'C:\Users\samue\.claude\projects\c--Users-samue-Coding-Sleeve-App\8b7ccc63-8b47-4abe-81a4-73ef997ac2f2.jsonl'
target_file = 'find-music-core.js'
output_path = r'C:\Users\samue\Coding\Sleeve-App\src\features\find-music\find-music-core.js'

os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # The content is typically in tool_use_result -> stdout or a tool_result object
            # We search for any value that contains 'find-music-core.js' and looks like code
            def search_recursive(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k == 'stdout' and isinstance(v, str) and 'find-music-core.js' in v and 'module.exports' in v:
                            return v
                        res = search_recursive(v)
                        if res: return res
                elif isinstance(obj, list):
                    for item in obj:
                        res = search_recursive(item)
                        if res: return res
                return None

            content = search_recursive(data)
            if content:
                # Clean up line numbers if present (e.g., "1\t'use strict';")
                lines = content.split('\n')
                cleaned = []
                for l in lines:
                    if '\t' in l and l.split('\t')[0].isdigit():
                        cleaned.append(l.split('\t', 1)[1])
                    else:
                        cleaned.append(l)
                
                with open(output_path, 'w', encoding='utf-8') as out:
                    out.write('\n'.join(cleaned))
                print("SUCCESS")
                exit(0)
        except:
            continue
print("FAILURE")
