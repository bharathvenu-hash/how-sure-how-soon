"""Count README prose words, leaving out fenced code blocks and inline code."""
import re, sys
text = open(sys.argv[1] if len(sys.argv) > 1 else "README.md").read()
text = re.sub(r"```.*?```", " ", text, flags=re.S)
text = re.sub(r"`[^`]*`", " ", text)
text = re.sub(r"\]\([^)]*\)", "]", text)          # link targets
text = re.sub(r"[#>*|\-]+", " ", text)
print(len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’.,:;/()+-]*", text)))
