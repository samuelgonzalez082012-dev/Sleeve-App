import json
import sys

transcript_path = r'C:\Users\samue\.claude\projects\c--Users-samue-Coding-Sleeve-App\8b7ccc63-8b47-4abe-81a4-73ef997ac2f2.jsonl'
target_file = 'find-music-core.js'

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # Look for tool use or tool results that contain the file content
            if 'tool_use' in str(data) or 'tool_result' in str(data):
                content_str = str(data)
                if target_file in content_str:
                    # If it's a result of a Read tool, it might be in a 'content' field
                    # This is a simplified recovery; we'll look for the pattern
                    print("FOUND_MATCH")
                    print(content_str)
        except:
            continue
