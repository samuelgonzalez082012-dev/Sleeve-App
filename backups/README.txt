Sleeve duplicate detection — local patch bundle

IMPORTANT
- This bundle does NOT connect to GitHub and does NOT update your repository.
- It is an integration patcher for the current Sleeve file layout, not a ready-made full replacement for the entire app.
- Run the tests first with: node --test duplicate-detection.test.js
- Then copy apply-duplicates.js and duplicate-detection.js into the local Sleeve project root and run: node apply-duplicates.js
- The patcher checks its expected insertion points before writing files. It changes index.html, renderer.js, and main.css, and renames Main.css to main.css if needed.
- Removing a copy removes it from Sleeve's library only; it does not delete the file from disk.
- Duplicate detection is conservative: tagged matches use normalized title + artist and duration within 2.5 seconds; untagged matches require normalized title + matching file size.
