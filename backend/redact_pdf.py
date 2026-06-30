import sys
import json
import io
import fitz  # PyMuPDF

def main():
    try:
        if len(sys.argv) < 2:
            print("Missing redactions JSON argument", file=sys.stderr)
            sys.exit(1)
            
        redactions_json = sys.argv[1]
        try:
            redactions = json.loads(redactions_json)
        except json.JSONDecodeError:
            print("Invalid JSON", file=sys.stderr)
            sys.exit(1)
            
        # Read PDF from stdin as binary
        pdf_bytes = sys.stdin.buffer.read()
        if not pdf_bytes:
            print("No PDF bytes received on stdin", file=sys.stderr)
            sys.exit(1)
            
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        for group in redactions:
            text_to_redact = group.get("value")
            occurrences = group.get("occurrences", [])
            
            if not text_to_redact or not text_to_redact.strip():
                continue
                
            # Collect all areas across all pages for this text
            all_areas = []
            for page in doc:
                areas = page.search_for(text_to_redact)
                for area in areas:
                    all_areas.append((page, area))
            
            if len(all_areas) != len(occurrences):
                # Mismatch warning, fallback to redacting all areas if ANY is 'redact'
                print(f"Warning: Match count mismatch for '{text_to_redact}'. Found {len(all_areas)}, expected {len(occurrences)}.", file=sys.stderr)
                any_redact = any(occ.get("action") == "redact" for occ in occurrences)
                if any_redact:
                    for page, area in all_areas:
                        page.add_redact_annot(
                            area, 
                            text=f"<{group.get('type', 'REDACTED')}>", 
                            fill=(0.15, 0.15, 0.15), 
                            text_color=(1, 1, 1)
                        )
            else:
                for idx, (page, area) in enumerate(all_areas):
                    if occurrences[idx].get("action") == "redact":
                        type_label = occurrences[idx].get("type", group.get("type", "REDACTED"))
                        page.add_redact_annot(
                            area, 
                            text=f"<{type_label}>", 
                            fill=(0.15, 0.15, 0.15), 
                            text_color=(1, 1, 1)
                        )
        
        # Apply redactions after adding annotations for all groups
        for page in doc:
            page.apply_redactions()
            
        # Save to stdout
        buffer = io.BytesIO()
        doc.save(buffer)
        sys.stdout.buffer.write(buffer.getvalue())
        
    except Exception as e:
        print(f"Python Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
