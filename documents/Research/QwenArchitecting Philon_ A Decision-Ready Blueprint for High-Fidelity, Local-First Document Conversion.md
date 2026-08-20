# Architecting Philon: A Decision-Ready Blueprint for High-Fidelity, Local-First Document Conversion

## Executive Recommendation: The Philon Thesis

The central thesis of Philon is to evolve beyond the single-pipeline, LLM-reliant model of its predecessor, Marker, into a sophisticated, multi-stage, adaptive routing system. This new architecture will prioritize both accuracy and performance by intelligently decoupling extraction from rendering and applying computational resources only where necessary. Philon’s core strategy is "native-first, AI-second": it will leverage the inherent semantic structure of born-digital PDFs whenever possible, using fast, low-level parsers to extract high-quality text with minimal latency. High-resolution rasterization, Optical Character Recognition (OCR), and Vision-Language Model (VLM) repair mechanisms will be deployed as targeted, intelligent fallbacks for regions of uncertainty, complex layouts, or specialized content like mathematical formulae. This approach directly addresses the primary performance bottlenecks of Marker, which relies heavily on computationally expensive OCR for nearly all pages [[73](https://www.reddit.com/r/Python/comments/1ls6hj5/i_benchmarked_4_python_text_extraction_libraries/), [74](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)], while enabling continued accuracy improvements through selective AI usage.

To enable this advanced architecture and ensure broad adoption, Philon must be built on a permissive software license (e.g., MIT or Apache 2.0). This decision is non-negotiable, as it allows for integration into commercial applications and fosters a healthy ecosystem of plugins and extensions, distinguishing it from Marker's GPL license which can complicate proprietary use [[70](https://www.youtube.com/watch?v=AgHWsfwmfNQ&vl=en), [72](https://stackoverflow.com/questions/20243214/how-to-change-the-license-for-a-project-at-github)]. The platform's target users are developers, researchers, and enterprises working in data science, information retrieval, and AI-driven workflows who require high-fidelity document conversion for tasks such as RAG pipelines, data ingestion, and accessibility remediation [[14](https://github.com/kissgyorgy/my-stars/blob/master/README.md), [55](https://www.searchcans.com/blog/pdf-markdown-rag-tools/)]. Philon positions itself not just as another converter, but as a foundational tool for turning unstructured documents into reliable, machine-readable knowledge [[27](https://unstructured.io/insights/unstructured-data-preparation-the-complete-ai-pipeline-guide)].

The guiding principles for Philon's development are:
1.  **Source Grounding and Provenance:** Every piece of extracted information must be traceable back to its origin in the source document, including page number, coordinates, extraction method, and confidence score. This transparency builds trust and enables debugging.
2.  **Determinism in Local Mode:** In its default local-only mode, Philon must produce bit-for-bit reproducible outputs for the same input file, ensuring reliability and consistency across runs.
3.  **Selective AI Usage:** While acknowledging the power of modern AI, Philon will not rely on it as the primary extraction mechanism. Instead, AI models will serve as precision instruments for verification, correction, and handling edge cases, used judiciously to balance cost, latency, and accuracy.
4.  **Performance First:** The adaptive routing architecture is designed to be exceptionally fast for common, well-structured documents, outperforming Marker in these scenarios while retaining the capability to handle complexity when required.
5.  **Public Accountability:** Philon will be backed by a rigorous, public, and reproducible benchmarking framework designed to prevent gaming and provide verifiable claims of superiority over competing solutions.

By adhering to this thesis, Philon will deliver a next-generation document conversion platform that is more accurate, faster, flexible, and commercially viable than any solution currently available.

## Marker Codebase Audit and Competitive Landscape

A thorough audit of the Marker codebase and its surrounding ecosystem reveals its strengths, critical limitations, and the strategic opportunities for Philon. This section provides an evidence-based inventory of Marker's capabilities and contrasts them with the broader competitive landscape across six key technical domains.

The Marker repository (`datalab-to/marker`) serves as the foundation for this analysis [[37](https://github.com/datalab-to/marker)]. Its primary function is converting PDFs to Markdown, JSON, chunks, and HTML [[37](https://github.com/datalab-to/marker)]. It operates via a CLI, API, and server interface, with a renderer architecture focused on extracting blocks of content [[69](https://github.com/adithya-s-k/marker-api), [77](https://news.ycombinator.com/item?id=38482007)]. However, its effectiveness is heavily dependent on external models and tools. It uses Surya for OCR and layout analysis [[32](https://www.madebyagents.com/blog/best-open-source-ocr-for-ai-agents)], PyTorch for model inference, and LLM services for repair [[77](https://news.ycombinator.com/item?id=38482007)]. This reliance creates significant dependencies and performance bottlenecks. For instance, processing 94 diverse documents was reported to take over 60 minutes, indicating substantial latency [[73](https://www.reddit.com/r/Python/comments/1ls6hj5/i_benchmarked_4_python_text_extraction_libraries/)]. Speed is further constrained by duplicated work, fixed-stages, and high VRAM requirements due to GPU-dependent model execution [[74](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)]. Licensing is a major constraint; the Marker code is under the GPL license, and its models use a modified OpenRAIL-style license, making direct reuse in a permissive/commercial architecture impossible without significant reimplementation [[70](https://www.youtube.com/watch?v=AgHWsfwmfNQ&vl=en)]. Despite these issues, Marker demonstrates state-of-the-art accuracy, particularly on complex documents like forms and scanned papers, achieving a 76.0% overall score on one benchmark and showing a 20-point lead over Docling on forms [[37](https://github.com/datalab-to/marker), [102](https://idp-software.com/vendors/datalab/)].

| Category | Marker Capabilities & Limitations | Evidence |
| :--- | :--- | :--- |
| **Input/Output** | PDF input; outputs Markdown, JSON, chunks, HTML. Limited to PDF format. | [[37](https://github.com/datalab-to/marker), [77](https://news.ycombinator.com/item?id=38482007)] |
| **Extraction Pipeline** | Relies on rasterizing pages, running OCR (Surya), and using VLMs for repair. Fixed, sequential stages. | [[32](https://www.madebyagents.com/blog/best-open-source-ocr-for-ai-agents), [77](https://news.ycombinator.com/item?id=38482007)] |
| **Speed & Bottlenecks** | High latency (e.g., >60 mins for 94 docs). GPU/CPU/MPS support exists but requires high VRAM. | [[73](https://www.reddit.com/r/Python/comments/1ls6hj5/i_benchmarked_4_python_text_extraction_libraries/), [74](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)] |
| **Accuracy Gaps** | Does not convert 100% of equations to LaTeX. Accuracy degrades on some complex forms. | [[39](https://pypi.org/project/marker-pdf/0.3.2/), [102](https://idp-software.com/vendors/datalab/)] |
| **Licensing** | Codebase is GPL licensed. Models use a modified OpenRAIL-style license. Not suitable for permissive/commercial use. | [[70](https://www.youtube.com/watch?v=AgHWsfwmfNQ&vl=en)] |

The competitive landscape is vibrant, with several strong contenders vying for dominance in the open-source space. Docling, developed by IBM, is a highly efficient parser that outputs structured JSON and has shown strong performance, particularly on table extraction (97.9% accuracy on one IBM benchmark) [[5](https://www.ertas.ai/blog/pdf-parsing-accuracy-benchmark-docling-unstructured), [85](https://www.reddit.com/r/LocalLLaMA/comments/1ghbmoq/docling_is_a_new_library_from_ibm_that/)]. MinerU, also from Datalab, focuses on OCR upgrades and pipeline optimization, with recent versions improving OCR capabilities significantly [[107](https://github.com/opendatalab/mineru), [108](https://github.com/opendatalab/MinerU/releases)]. Unstructured.io offers a comprehensive platform for turning various file types into structured JSON, positioning itself as a data ingestion layer for AI systems [[21](https://unstructured.io/), [23](https://unstructured.io/insights/data-ingestion-building-modern-data-pipelines)]. Other notable tools include MarkItDown, known for preserving structural elements [[42](https://www.edge-ai-vision.com/2026/01/top-python-libraries-of-2025/)], and Nougat, a specialized academic parser that understands LaTeX [[86](https://github.com/facebookresearch/nougat)].

| Tool/Framework | Key Strengths | Key Weaknesses | License |
| :--- | :--- | :--- | :--- |
| **Marker** | High accuracy on complex documents (forms, scans); good equation/table handling. | Very slow; high VRAM/GPU dependency; GPL license limits commercial use. | GPL / Modified OpenRAIL |
| **Docling** | Efficient; outputs structured JSON; strong table extraction accuracy. | May lag behind Marker on extreme complexity. | MIT / Apache 2.0 [[29](https://imagetotable.ai/blog/best-open-source-ocr-tools-2026)] |
| **MinerU** | Focus on OCR capability upgrades; optimized processing pipeline. | Accuracy can vary; less mature than Marker in some areas. | MIT / Apache 2.0 [[29](https://imagetotable.ai/blog/best-open-source-ocr-tools-2026)] |
| **Unstructured.io** | Broad file type support (>64); excellent for data ingestion into AI pipelines. | Can be less precise for pure PDF-to-Markdown conversion compared to specialists. | Apache 2.0 [[29](https://imagetotable.ai/blog/best-open-source-ocr-tools-2026)] |
| **Nougat** | State-of-the-art for academic PDFs; understands and converts LaTeX. | Specialized for academic papers; not a general-purpose converter. | CC BY-NC-SA 4.0 |
| **Mathpix** | Commercial service with very high accuracy; excellent for math and tables. | Proprietary; not open-source; costs associated with use. | Proprietary |

In the native PDF parsing domain, libraries like `PyMuPDF` and `pdfminer` are fundamental building blocks [[11](https://github.com/yzlabai/docparse-rs), [103](https://medium.com/@pymupdf/rag-llm-and-pdf-conversion-to-markdown-text-with-pymupdf-03af00259b5d)]. They excel at extracting text, fonts, links, and basic structure from born-digital PDFs without rasterization, offering a potential path to significant speed improvements for simple documents [[11](https://github.com/yzlabai/docparse-rs)]. For OCR, the landscape has evolved rapidly. While Tesseract remains a baseline option, newer models like PaddleOCR-VL, OlmOCR-2, and MistralOCR offer superior accuracy, multilingual support, and better layout preservation [[30](https://unstract.com/blog/best-opensource-ocr-tools/), [67](https://www.e2enetworks.com/blog/complete-guide-open-source-ocr-models-2025), [68](https://www.linkedin.com/posts/aboniasojasingarayar_ocr-opensource-documentai-activity-7391736028996313088-gLfu)]. Critically, many of these modern alternatives carry permissive licenses (Apache 2.0 or MIT), making them suitable candidates for Philon's architecture [[28](https://medium.com/@AiDocTakes/i-tested-four-ocr-models-on-scanned-medical-records-and-the-smallest-one-won-ed7185b1c0b2), [29](https://imagetotable.ai/blog/best-open-source-ocr-tools-2026)].

Layout analysis is another critical area. Tools like LayoutParser, DeepDoctection, and MinerU provide robust frameworks for detecting document elements like tables, figures, and headings [[6](https://adityamangal98.medium.com/docling-vs-marker-vs-mineru-the-ultimate-open-source-pdf-parser-benchmark-2026-which-is-best-a36ecbb6c6b1)]. Benchmarks like DocBank and ReadingBank provide standardized datasets for evaluating the performance of these models [[40](https://github.com/doc-analysis/DocBank), [41](https://github.com/doc-analysis/ReadingBank)]. For tables and formulas, the challenge lies in reconstruction. OmniDocBench has emerged as a key benchmark for evaluating models on these specific tasks, highlighting the need for solutions that can accurately parse nested tables, borderless tables, and reconstruct LaTeX from images [[87](https://codesota.com/browse/computer-vision/document-parsing/omnidocbench), [89](https://openaccess.thecvf.com/content/CVPR2025/papers/Ouyang_OmniDocBench_Benchmarking_Diverse_PDF_Document_Parsing_with_Comprehensive_Annotations_CVPR_2025_paper.pdf?utm_source=chatgpt.com)]. Finally, the role of LLMs and VLMs is shifting from being the primary extractor to being powerful repair agents. Their ability to perform cross-page reasoning and provide structured, constrained outputs makes them ideal for verifying and correcting errors made by other components in the pipeline [[18](https://unstructured.io/blog/introducing-extract), [50](https://www.semanticscholar.org/paper/985050b4db8d1b99d337d7c8137393581e1337c3)]. This nuanced role is crucial for Philon's strategy of using AI selectively and effectively.

## Proposed Philon Architecture: An Adaptive, Multi-Stage Processing Pipeline

To surpass Marker's performance and licensing constraints, Philon will implement an adaptive, multi-stage processing pipeline. This architecture moves away from Marker's monolithic, "one-size-fits-all" approach and instead employs a smart router to dynamically select the most appropriate processing tool for each region of a document based on real-time quality assessment. The core principle is to minimize unnecessary computation—specifically, the costly process of high-resolution rasterization and OCR—by leveraging native PDF structure wherever possible. This design directly targets the primary performance bottleneck of Marker, which applies its heavy OCR-based processing to every page regardless of its complexity or native readability [[73](https://www.reddit.com/r/Python/comments/1ls6hj5/i_benchmarked_4_python_text_extraction_libraries/), [74](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026)].

The proposed architecture is centered around a modular component design with clear plugin interfaces. At its heart is the **Router**, a decision-making engine that orchestrates the entire process. It receives a PDF file and delegates tasks to pluggable **Extractor Modules**. These modules are responsible for specific types of content: a `NativeTextExtractor`, an `OcrExtractor`, a `TableDetector`, a `FormulaConverter`, and so on. Once extraction is complete, the resulting data is assembled into the canonical **Document IR**. From there, pluggable **Renderer Modules** take the IR and produce the final desired output format, such as Markdown, Semantic HTML, or JSON. This decoupling of extraction from rendering is fundamental to achieving deterministic outputs and enabling future extensibility [[2](https://medium.com/@sirio1234/from-static-to-dynamic-converting-pdf-documents-to-html-with-python-aa2772ac0fba)].

The data flow begins when a PDF is ingested. The first stage is a **Native-First Inspection**. Using a fast, low-level parser like `PyMuPDF` or `pdfminer.six`, the system extracts all available text, font information, bounding boxes, and links without any rasterization [[11](https://github.com/yzlabai/docparse-rs), [103](https://medium.com/@pymupdf/rag-llm-and-pdf-conversion-to-markdown-text-with-pymupdf-03af00259b5d)]. This step is extremely fast and sufficient for high-quality, born-digital PDFs. The extracted native text is then passed to a series of **Quality Gates**. These gates are not based on vague AI confidence scores but on concrete, measurable signals. The system checks for garbled text, encoding corruption, missing glyphs, invisible text layers, and whether the text aligns visually with the underlying image of the page [[63](https://unstract.com/blog/why-pdf-to-markdown-ocr-fails-for-ai-document-processing/)]. If the native text passes these gates with high confidence, it is immediately passed to the renderer. This path ensures near-instantaneous processing for simple documents.

If the native text fails any quality gate, the router triggers a conditional escalation. The problematic region is flagged for higher-fidelity processing. The router then decides the optimal next step based on the nature of the failure. For example, if reading order is disjointed, it may invoke a layout analysis model like MinerU to establish a plausible sequence [[6](https://adityamangal98.medium.com/docling-vs-marker-vs-mineru-the-ultimate-open-source-pdf-parser-benchmark-2026-which-is-best-a36ecbb6c6b1)]. If the text is completely illegible, the router directs the corresponding page region to be rendered at a high resolution (e.g., 300 DPI or higher) and processed by an advanced OCR engine like PaddleOCR-VL [[33](https://gigagpu.com/best-ocr-models-2026/), [67](https://www.e2enetworks.com/blog/complete-guide-open-source-ocr-models-2025)]. This dynamic adjustment of DPI is a key optimization; low-quality scans might require 300+ DPI, while clean text might only need 72 DPI for visual alignment checks.

For specialized content, the router invokes dedicated processors. When a table is detected, it is passed to a specialized table parser, potentially using techniques from benchmarks like OmniDocBench to handle complex structures like spanning cells and nested tables [[87](https://codesota.com/browse/computer-vision/document-parsing/omnidocbench)]. Similarly, when a mathematical expression is identified, it is routed to a model like Nougat, which is specifically trained to recognize LaTeX syntax in academic documents [[86](https://github.com/facebookresearch/nougat)]. This specialization ensures that the best tool is always used for the job, rather than forcing all content through a generic OCR pipeline.

Finally, after both native and escalated extractions are complete, a **VLM Repair Loop** acts as a final verification pass. This is a critical departure from Marker's primary reliance on VLMs. In Philon, the VLM is not the first line of defense but a fine-tuning mechanism. It receives the initial extraction and is tasked with identifying and correcting specific errors, such as misidentified symbols or broken structure, based on its visual understanding of the page [[18](https://unstructured.io/blog/introducing-extract)]. This selective block-level repair is far more efficient and cost-effective than regenerating entire pages [[18](https://unstructured.io/blog/introducing-extract)]. The router uses disagreement checks between the native, OCR, and VLM-derived results to decide whether a block needs repair and to generate a final, consensus output. This multi-layered, tiered approach ensures maximum accuracy for complex documents while providing exceptional speed for simpler ones, forming the architectural backbone of Philon.

```mermaid
graph TD
    A[Start: Ingest PDF] --> B{Native-First Inspection<br>via PyMuPDF/pdfminer}
    B -- Passes Quality Gates --> M[Renderer: Generate Markdown/HTML]
    B -- Fails Quality Gates --> C[Router: Classify Failure Type]
    
    C -->|Garbled Text/No Native| D[High-Res Rasterize (300 DPI+)]
    C -->|Disjointed Layout| E[Layout Analysis (MinerU/LayoutParser)]
    C -->|Specialized Content| F[Invoke Specialized Processor<br>(Nougat for Math, Table Parser)]

    D --> G[OCR Engine (PaddleOCR-VL)]
    E --> H[Re-establish Reading Order]
    F --> I[Process Specialized Content]

    G --> J[Assemble IR]
    H --> J
    I --> J
    
    J --> K[VLM Repair Loop<br>(Selective Block Correction)]
    K --> L[Finalize Document IR]
    L --> M
```

This architecture supports progressive output, cancellation, caching, and resumability by operating on a block-by-block basis. Each block's processing status and results can be cached, allowing a failed job to resume from the last successful step. The router's logic is designed to be deterministic in local-only mode, ensuring reproducible results, while still supporting an optional, pluggable cloud-assisted mode for tasks that exceed local hardware capabilities [[38](https://www.file2markdown.ai/blog/best-pdf-to-markdown-converter)].

## Canonical Document Internal Representation (IR)

The cornerstone of Philon's architecture is its canonical internal representation (IR)—a versioned, loss-aware, and meticulously detailed JSON structure that serves as the universal intermediate format for all document data. This IR decouples the complex, multi-stage extraction process from the final rendering phase, enabling deterministic outputs, full source provenance, and extensibility to multiple export formats [[2](https://medium.com/@sirio1234/from-static-to-dynamic-converting-pdf-documents-to-html-with-python-aa2772ac0fba), [19](https://unstructured.io/insights/structured-vs-unstructured-data-5-transformation-methods)]. The design is heavily influenced by the success of similar structured JSON outputs from competitors like Unstructured and Docling, which have become de facto standards for transforming unstructured files into schema-ready inputs [[5](https://www.ertas.ai/blog/pdf-parsing-accuracy-benchmark-docling-unstructured), [26](https://unstructured.io/blog/getting-started-with-unstructured-and-delta-tables-in-databricks), [94](https://docs.unstructured.io/api-reference/legacy-api/partition/transform-schemas)]. The Philon IR is designed to be both human-readable for debugging and machine-processable for downstream applications like RAG pipelines [[14](https://github.com/kissgyorgy/my-stars/blob/master/README.md)].

The top-level object in the IR is the `Document` object. It contains global metadata about the source file, such as title, author, creation date, and page count, along with a `version` field (e.g., `"1.1.0"`) to manage schema evolution. The `Document` object holds an array of `Page` objects, each representing a single page of the original document.

Each `Page` object contains the page number (1-indexed) and an array of `Block` objects. A `Block` is a polymorphic container that represents a logical unit of content on the page. It has a mandatory `type` field (e.g., `'paragraph'`, `'heading'`, `'list'`, `'table'`, `'figure'`, `'code_block'`, `'horizontal_rule'`) and an array of `InlineSpan` objects that represent formatted text segments within it. This separation of block-level structure from inline formatting (like bold or italic) provides granular control over rendering.

Every single piece of content within a `Block` or `InlineSpan` is accompanied by a rich `source_map` object. This is the most critical component for ensuring fidelity and trustworthiness. The `source_map` provides an immutable record of the content's origin. It includes the `pdf_page` number, a `bounding_box` array `[x1, y1, x2, y2]` defining the exact location in points, the `extraction_method` used (e.g., `'native_text', 'ocr_surya', 'nougat_formula'`), and a numerical `confidence` score (0.0 to 1.0). Furthermore, it can contain an array of alternative `extractions` if multiple methods were tried and disagreed, allowing for sophisticated error analysis and repair. This level of detail is essential for creating verifiable golden-output test suites and for providing users with a clear understanding of the conversion's certainty [[13](https://github.com/jakewvincent/mkdnflow.nvim), [63](https://unstract.com/blog/why-pdf-to-markdown-ocr-fails-for-ai-document-processing/)].

Specialized block types have additional properties. A `Table` block contains a two-dimensional array of `Cell` objects. Each `Cell` can hold its own `Block` content, allowing for nested tables. A `Figure` block contains a reference to an embedded asset and a `caption` field, which is itself a `Block` object, allowing captions to be semantically structured. Inline spans can also reference links and citations, with their own `source_map` pointing back to the relevant anchors in the document.

Below is a simplified schema illustrating the structure:

```json
{
  "version": "1.1.0",
  "metadata": {
    "title": "Example Research Paper",
    "author": "Jane Doe",
    "page_count": 5
  },
  "pages": [
    {
      "page_number": 1,
      "blocks": [
        {
          "id": "b1",
          "type": "heading",
          "depth": 1,
          "children": [
            {
              "text": "An Introduction to Advanced Document Conversion",
              "spans": []
            }
          ],
          "source_map": {
            "pdf_page": 1,
            "bounding_box": [72, 720, 540, 750],
            "extraction_method": "native_text",
            "confidence": 0.99
          }
        },
        {
          "id": "b2",
          "type": "paragraph",
          "children": [
            {
              "text": "This is a sample paragraph. The Philon platform aims to convert such documents with high fidelity. ",
              "spans": []
            },
            {
              "text": "See the following table:",
              "spans": []
            }
          ],
          "source_map": {
            "pdf_page": 1,
            "bounding_box": [72, 680, 540, 700],
            "extraction_method": "native_text",
            "confidence": 0.95
          }
        },
        {
          "id": "b3",
          "type": "table",
          "children": [
            [
              { "text": "Header 1", "spans": [] },
              { "text": "Header 2", "spans": [] }
            ],
            [
              { "text": "Row 1, Cell 1", "spans": [] },
              { "text": "Row 1, Cell 2", "spans": [] }
            ]
          ],
          "source_map": {
            "pdf_page": 1,
            "bounding_box": [72, 600, 540, 640],
            "extraction_method": "specialized_table_parser_omnidocbench_v2",
            "confidence": 0.98
          }
        }
      ]
    }
  ]
}
```

This detailed, loss-aware IR provides the necessary granularity to support all required output modes deterministically. It allows for the creation of faithful Markdown and accessible HTML renderers, and its structured nature makes it an ideal input for chunking algorithms for RAG systems. By treating the IR as a first-class citizen, Philon establishes a robust and transparent foundation for high-fidelity document conversion.

## Output Strategy: Fidelity Guarantees for Markdown, HTML, and JSON/IR

Philon's output strategy will be productized in a phased, prioritized manner, starting with formats that offer the highest utility and value to the core user base. The primary goal is to deliver outputs that are not only syntactically correct but also semantically meaningful, structurally sound, and faithfully represent the source document. A key aspect of this strategy is establishing clear fidelity guarantees and documenting irreducible limitations to manage user expectations.

**v1: Essential Outputs - Markdown, Semantic HTML, and JSON/IR**

The initial release (v1) will focus on three core formats, all derived from the canonical Document IR.

1.  **Markdown (Optimized for Humans and RAG):** The Markdown output will be a dual-purpose format. For human consumption, it will prioritize clean, readable prose, correctly rendering headings, lists, emphasis, and blockquotes. For RAG pipelines, its primary strength will be the accurate preservation of structural elements that are often lost in naive conversions. This includes correctly formatted tables, fenced code blocks with proper language identifiers, and clear delineation of figures and other elements [[55](https://www.searchcans.com/blog/pdf-markdown-rag-tools/), [57](https://tools.nanonets.com/pdf-to-markdown)]. To achieve this, Philon will use a robust Markdown compiler like `marked.js` or `intellij-markdown` which are designed for speed and correctness [[8](https://github.com/markedjs/marked), [9](https://github.com/JetBrains/markdown)]. Fidelity guarantees for Markdown include:
    *   **Structure:** All heading levels, ordered/unordered lists, and blockquote elements will be preserved with correct nesting.
    *   **Tables:** Table structure (rows and columns) will be maintained using standard Markdown table syntax. Spanning cells will be handled gracefully, though complex nested tables may be simplified.
    *   **Code Blocks:** Text identified as code will be wrapped in triple-backtick fences with an optional language tag.
    *   **Irreducible Limitations:** Extremely complex, hand-drawn diagrams or custom vector graphics cannot be converted into text-based representations. Handwriting will be converted to typed text via OCR, losing the original stylistic nuances.

2.  **Semantic and Accessible HTML5:** This is a key differentiator for Philon. The HTML output will not be a simple translation but a purpose-built, accessible web document. It will adhere strictly to HTML5 standards and be validated to ensure well-formedness [[2](https://medium.com/@sirio1234/from-static-to-dynamic-converting-pdf-documents-to-html-with-python-aa2772ac0fba)]. Crucially, it will be designed for accessibility, conforming to WCAG 2.2 guidelines [[79](https://www.w3.org/TR/WCAG22/), [84](https://www.webability.io/blog/understanding-wcag-2-2-a-practical-guide)]. This involves using appropriate semantic tags (`<header>`, `<main>`, `<section>`, `<article>`, `<table>`, `<caption>`, `<figcaption>`), adding ARIA roles where necessary, and ensuring proper contrast ratios. To maintain the core tenet of provenance, every element in the generated HTML will include `data-*` attributes containing the `source_map` information from the IR. For example, `<p data-provenance-id="b2">...</p>` would link the paragraph back to its extraction record [[81](https://digitalaccessibility.virginia.edu/converting-documents-html-creating-accessible-and-responsive-web-content-march-2026)]. Post-conversion, the HTML can be automatically checked for accessibility compliance using tools like `axe-core` [[99](https://github.com/dequelabs/axe-core), [101](https://www.reddit.com/r/webdev/comments/j5b931/what_tools_are_you_using_to_ensure_your_website/)]. Fidelity guarantees for HTML include:
    *   **Validity and Semantics:** The output will be valid, well-formed HTML5 that accurately reflects the document's structure.
    *   **Accessibility:** The document will be marked as compliant with WCAG 2.2 Level AA standards.
    *   **Asset Handling:** Images and other assets will be embedded or linked correctly.
    *   **Irreducible Limitations:** Complex CSS styling, interactive form fields, and certain advanced SVG features may not be perfectly replicated.

3.  **JSON/Document IR:** The canonical Document IR itself will be a primary export format. This provides users with a machine-readable, structured view of the parsed document, ready for programmatic manipulation, chunking for RAG, or feeding into other data processing pipelines [[44](https://unstructured.io/insights/what-is-information-retrieval-for-ai-applications), [94](https://docs.unstructured.io/api-reference/legacy-api/partition/transform-schemas)]. This output is guaranteed to be a lossless representation of the data extracted by the Philon pipeline, including all provenance information.

**v2: Advanced Outputs - DOCX and EPUB**

Following the stable release of v1, Philon will introduce support for widely used office and e-book formats. These will be implemented as secondary renderers built upon the canonical IR.

1.  **DOCX:** This format requires careful handling of styles, fonts, and layout. The Philon DOCX renderer will translate the semantic structure from the IR into corresponding Word styles (e.g., 'Heading 1', 'Intense Quote'). It will embed images and preserve hyperlinks. Fidelity guarantees will focus on maintaining the logical structure and readability of the document. The main limitation will be the faithful replication of the exact pixel-perfect position and appearance of complex, multi-column layouts from the original PDF.
2.  **EPUB:** Converting to EPUB presents challenges related to reflowable content and asset packaging [[3](https://developers.avanquest.com/features-sdk/conversion-sdk)]. The Philon EPUB renderer will create a standard, accessible EPUB3 file from the semantic HTML output, ensuring that images, CSS, and JavaScript (if any) are packaged correctly. The primary guarantee will be a device-independent, accessible reading experience that adapts to different screen sizes.

**v3: Niche Outputs - TEI, JATS, ALTO, hOCR**

These formats cater to specific academic, archival, and historical preservation communities. Their inclusion will depend on user demand gathered post-v1 launch.
*   **TEI (Text Encoding Initiative) & JATS (Journal Archiving and Interchange Tag Set):** These XML-based formats are used for scholarly publishing. Philon could generate these by mapping its `Block` types to the appropriate TEI/JATS tags.
*   **ALTO & hOCR:** These are XML formats for representing OCR results and their spatial locations. They are valuable for digitization projects and would be a natural extension of Philon's commitment to provenance. The output would map Philon's `source_map` data directly into the corresponding XML attributes.

This phased approach allows Philon to deliver immediate value with the most versatile formats (Markdown, HTML, JSON) while strategically planning for broader compatibility, ensuring that development resources are allocated efficiently.

## Benchmark Blueprint for Measurable Quality and Performance

To validate Philon's architectural advantages and provide verifiable proof of its superiority, a public, reproducible, and rigorously designed benchmark is essential. This blueprint outlines the components of the benchmark, drawing on established practices and addressing the need to prevent benchmark gaming. The evaluation system will measure Philon across a wide spectrum of metrics, including text fidelity, structural accuracy, speed, and resource consumption, against a diverse set of baselines.

**Test Corpus Composition**

The benchmark corpus must be representative of the real-world diversity of documents Philon is expected to process. It will be composed of multiple subsets, each targeting a different dimension of difficulty.
*   **Document Classes:** The corpus will include nine distinct document classes, mirroring the scope of benchmarks like OmniDocBench [[89](https://openaccess.thecvf.com/content/CVPR2025/papers/Ouyang_OmniDocBench_Benchmarking_Diverse_PDF_Document_Parsing_with_Comprehensive_Annotations_CVPR_2025_paper.pdf?utm_source=chatgpt.com), [90](https://arxiv.org/html/2412.07626v2)]. These will range from academic papers and textbooks to legal filings, invoices, magazines, slideshows, and scientific reports. This variety ensures the evaluation captures performance across different structural complexities.
*   **Document Quality:** Subsets will be created based on scan quality, ranging from high-resolution, born-digital PDFs to low-quality, noisy scans and documents with degraded print. This is critical for assessing the effectiveness of the adaptive routing logic.
*   **Language and Scripts:** The benchmark will include documents written in multiple languages, with a particular focus on challenging scripts like CJK (Chinese, Japanese, Korean) and RTL (Right-to-Left) languages like Arabic and Hebrew, for which OCR accuracy can be a significant challenge [[33](https://gigagpu.com/best-ocr-models-2026/)].
*   **Complexity and Length:** The corpus will feature documents of varying lengths, from single-page invoices to multi-hundred-page books. It will also include a specific "hard subset" focusing on documents with difficult formulas, complex tables, and dense layouts, similar to the one added to OmniDocBench [[106](https://huggingface.co/datasets/opendatalab/OmniDocBench)].

**Gold Data and Annotation Strategy**

High-quality ground truth (gold data) is the bedrock of any meaningful benchmark. For Philon, this gold data will be the canonical JSON IR produced by a meticulous manual annotation process or, for synthetic documents, derived directly from the source markup (e.g., LaTeX for papers) [[49](https://arxiv.org/html/2603.18652v1)]. The annotation strategy will follow the Philon IR schema, capturing not just the text but also the intended structure (headings, lists), tables, figures, and mathematical expressions. To ensure the long-term quality and relevance of the gold data, the benchmark will adopt a community review model inspired by PureDocBench, allowing the community to suggest corrections and improvements to the ground truth annotations [[109](https://github.com/zhihengli-casia/puredocbench)].

**Metrics for Evaluation**

The evaluation harness will compute a suite of quantitative metrics across multiple axes of quality.

| Metric Category | Specific Metrics | Description |
| :--- | :--- | :--- |
| **Text Fidelity** | Character Error Rate (CER), Word Error Rate (WER) | Measures the accuracy of raw text extraction by comparing the output to the gold-standard text. |
| **Structural Accuracy** | Heading/List Structure F1-Score, Reading Order Accuracy | Evaluates the correctness of the document's hierarchy and logical flow. Reading order can be measured against datasets like ReadingBank [[41](https://github.com/doc-analysis/ReadingBank)]. |
| **Table & Formula Extraction** | Table Cell-level Precision/Recall/F1, Formula Reconstruction Accuracy | Assesses the ability to correctly identify and extract the contents of tables and mathematical expressions. Formulas will be scored by comparing the reconstructed LaTeX to the ground-truth LaTeX [[87](https://codesota.com/browse/computer-vision/document-parsing/omnidocbench)]. |
| **HTML Validity & Accessibility** | W3C Validator Score, axe-core Violation Count | Automated checks to ensure the generated HTML is well-formed and compliant with WCAG 2.2 accessibility standards [[99](https://github.com/dequelabs/axe-core), [101](https://www.reddit.com/r/webdev/comments/j5b931/what_tools_are_you_using_to_ensure_your_website/)]. |
| **Source Map Correctness** | Provenance Hit Rate | The percentage of characters in the output that can be successfully mapped back to a unique source location in the PDF. |
| **Speed & Performance** | Cold/Warm Latency (ms/page), Throughput (pages/sec), GPU/CPU/MPS Utilization, Memory/VRAM Usage, Cost/Page (for cloud models) | Comprehensive measurement of processing time and resource consumption, separating cold starts from steady-state performance [[36](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)]. |

**Baseline Comparison and Anti-Gaming Controls**

To provide context for Philon's performance, the benchmark will compare it against a wide range of state-of-the-art solutions. This includes open-source tools like Marker, Docling, MinerU, and Unstructured, as well as leading commercial APIs like Mathpix and LlamaParse [[7](https://www.youtube.com/watch?v=8RxT5jTcemY), [35](https://github.com/pdfmarkdownapp/pdf-to-markdown-benchmark), [36](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)]. Comparisons will be clearly separated into local/open-source and managed API categories to ensure a fair, apples-to-apples evaluation.

To prevent benchmark gaming, where developers might inadvertently tune their models to perform well on a static test set, several controls will be implemented. The full benchmark dataset will be kept private until evaluation periods and will be updated regularly with new, challenging documents. The scoring will emphasize structural and semantic accuracy (e.g., table structure, heading hierarchy) over simple character matching, as the latter is easier to game. Finally, the CI regression strategy will involve running nightly tests on a small, curated subset of the benchmark to catch regressions early and ensure that new commits do not degrade existing functionality [[45](https://github.com/finos-labs/ai-evals-framework)].

## Implementation Roadmap and Technology Stack

This section outlines a concrete 30/60/90-day implementation roadmap for building Philon, including technology choices, module boundaries, and risk mitigation strategies. The plan is designed to deliver a functional v1 product with the core adaptive routing architecture and essential output formats.

**Technology Stack and Dependencies**

The selection of technologies will prioritize a permissive license (MIT or Apache 2.0) to enable broad adoption and commercial use, explicitly avoiding the GPL-licensed Marker codebase [[70](https://www.youtube.com/watch?v=AgHWsfwmfNQ&vl=en), [72](https://stackoverflow.com/questions/20243214/how-to-change-the-license-for-a-project-at-github)].

| Component | Recommended Choice | Alternatives | Justification |
| :--- | :--- | :--- | :--- |
| **Language/Runtime** | Python 3.10+ | Rust (with PyO3 bindings) | Mature ecosystem for ML, data science, and scripting. Fast development cycle. |
| **PDF Parsing** | `PyMuPDF` (fitz) | `pdfminer.six` | Excellent performance and comprehensive features for low-level PDF inspection. `pdfminer` is a strong alternative for deep structural analysis. |
| **OCR Engine** | `PaddleOCR` | `Surya` | Permissive Apache 2.0 license; excellent multilingual support and high accuracy. `Surya` is also a strong contender with a permissive license. |
| **Layout Analysis** | `MinerU` | Custom `LayoutParser` model | Provides pre-trained models for element detection. A custom model could be trained on OmniDocBench data for higher accuracy. |
| **Formula Conversion** | `Nougat` | `DeepSeek-OCR` | Specifically designed for academic PDFs and LaTeX conversion. High accuracy in this niche. |
| **VLM/Repair** | Open-source models from `OpenCompass` or `Groq/OpenBench` | Paid APIs (e.g., Claude, GPT-4V) | Allows for experimentation with repair capabilities before committing to paid services. |
| **Markdown Rendering** | `marked.js` (via Node.js bridge) or `mistune` | `intellij-markdown` (Kotlin) | Highly optimized and standards-compliant libraries for generating Markdown. |
| **HTML Validation** | `html5validator` | Built-in browser validators | Ensures generated HTML is well-formed and valid. |
| **Accessibility Testing** | `axe-core` (via Playwright/Selenium) | `pa11y` | Industry-standard tool for automated accessibility auditing. |
| **Evaluation Framework** | `deepEval` or custom script | `OpenCompass` | Modular and easy-to-use for defining evaluation tests as "unit tests" for LLM systems. |

**Module and File Layout Proposal**

The project will be organized into a modular Python package structure:

```
philon/
├── philon/core/          # Core logic and interfaces
│   ├── router.py         # Main routing orchestration
│   ├── ir.py             # Document IR schema and serializers
│   └── job.py            # Job model for tracking state
├── philon/extractors/    # Pluggable extractor modules
│   ├── __init__.py
│   ├── native.py         # Implements native text extraction
│   ├── ocr.py            # Wraps PaddleOCR
│   ├── table.py          # Wraps specialized table parser
│   └── formula.py        # Wraps Nougat
├── philon/renderers/     # Pluggable renderer modules
│   ├── __init__.py
│   ├── markdown.py       # Renders IR to Markdown
│   └── html.py           # Renders IR to Semantic HTML
├── philon/benchmark/     # Benchmarking harness
│   ├── corpus/           # Test datasets
│   ├── scorers.py        # Metric calculation
│   └── harness.py        # Runs evaluation
└── cli.py                # Command-line interface
```

**30/60/90-Day Build Plan**

*   **Phase 1: Foundation (Days 1-30)**
    *   **Goals:** Establish the core infrastructure, define the IR, and implement the native-first extraction and basic rendering.
    *   **Tasks:**
        1.  Set up the Python project with Poetry for dependency management and pytest for testing.
        2.  Define the canonical JSON IR schema in `pydantic` models and implement serialization/deserialization functions.
        3.  Implement the `NativeTextExtractor` using `PyMuPDF`. This module will extract text, fonts, and bounding boxes.
        4.  Create the initial `MarkdownRenderer` that can render basic blocks (paragraphs, headings).
        5.  Curate a small, initial benchmark dataset of ~20 simple, born-digital PDFs.
        6.  Implement basic CER and WER metrics to evaluate the native extraction pass.
    *   **Milestones:** Version 0.1.0 released. Core IR and native extraction pipeline functional. Basic benchmark produces scores.

*   **Phase 2: Expansion and Intelligence (Days 31-60)**
    *   **Goals:** Integrate the adaptive routing logic, add support for complex elements, and implement the semantic HTML output.
    *   **Tasks:**
        1.  Develop the `Router` logic. Implement quality gates to detect garbled text and low-confidence regions.
        2.  Integrate the `OcrExtractor` (PaddleOCR) and connect it to the router to handle low-confidence text.
        3.  Add a `TableDetector` and integrate a specialized table parsing library.
        4.  Integrate the `FormulaConverter` (Nougat) to handle mathematical expressions.
        5.  Implement the `HtmlRenderer` with support for semantic tags and `data-provenance` attributes. Integrate `axe-core` for automated accessibility checks.
        6.  Expand the benchmark with documents containing tables, formulas, and mixed scripts.
    *   **Milestones:** Version 0.2.0 released. Adaptive routing and multi-element extraction functional. v1 output formats (MD, HTML, JSON) complete.

*   **Phase 3: Refinement and Validation (Days 61-90)**
    *   **Goals:** Implement the VLM repair loop, add advanced output formats, and conduct a full comparative evaluation.
    *   **Tasks:**
        1.  Experiment with open-source VLMs to implement a selective block-level repair mechanism as a final pass in the pipeline.
        2.  Implement the `DocxRenderer` and `EpubRenderer` based on the canonical IR.
        3.  Conduct a full comparative benchmark against Marker, Docling, and MinerU on the complete benchmark corpus.
        4.  Publish the initial benchmark results and make the evaluation harness open source.
        5.  Establish a CI/CD pipeline with nightly regression tests on the benchmark suite.
    *   **Milestones:** Version 1.0.0 alpha released. Full feature set complete. Public benchmark and results published.

**Testing Plan and Risks**

The testing plan will be comprehensive, covering unit, integration, golden-output, visual diffing, fuzzing, and adversarial PDF tests. Unit tests will cover individual functions. Integration tests will verify the interaction between modules. Golden-output tests will compare Philon's output against a trusted, manually-curated "golden" output for a set of key documents [[13](https://github.com/jakewvincent/mkdnflow.nvim)]. Visual diffing will be used to compare rendered outputs (e.g., HTML previews) against the golden standard. Fuzzing and adversarial PDF generation will stress-test the parser against malformed or malicious documents.

**Key Risks:**
*   **Performance:** The adaptive routing logic may prove too slow to be practical if the overhead of classification and routing outweighs the benefits of skipping OCR. Mitigation: Profile the router heavily during Phase 2 and optimize decision logic.
*   **Accuracy:** Achieving the desired accuracy with permissively licensed open-source models may be challenging, especially for niche tasks like form extraction. Mitigation: Continuously benchmark against Marker and be prepared to integrate proprietary APIs as a premium, optional feature.
*   **Licensing:** Accidentally depending on a GPL-licensed library remains a risk. Mitigation: Use tools like `license-checker` in the CI pipeline to enforce a whitelist of approved licenses (MIT, Apache 2.0).

**Open Questions for Product Decision:**
1.  What is the acceptable trade-off between latency and accuracy for the target user persona? Should the default behavior favor speed or maximum fidelity?
2.  Should the VLM repair loop be included in v1, or delayed to a later version to reduce complexity?
3.  What is the initial target market? Is it primarily academic/research (favoring LaTeX and tables) or enterprise/business (favoring forms and invoices)?

**Final Decision Log**

*   **Recommended Technologies:**
    1.  **Python:** For its vast ecosystem and rapid development.
    2.  **`PyMuPDF` + `pdfminer.six`:** For fast, low-level native PDF inspection.
    3.  **`PaddleOCR`:** For a powerful, permissively licensed OCR engine.
    4.  **`MinerU`:** As a starting point for layout analysis.
    5.  **`Nougat`:** For specialized, high-accuracy formula conversion.
    6.  **`marked.js` / `intellij-markdown`:** For robust Markdown rendering.
    7.  **`axe-core`:** For automated accessibility validation.
    8.  **`deepEval`:** For a flexible evaluation framework.

*   **Do Not Use / Do Not Depend On:**
    1.  **Marker Codebase:** Due to the restrictive GPL license, which conflicts with the goal of a permissive/commercial architecture [[72](https://stackoverflow.com/questions/20243214/how-to-change-the-license-for-a-project-at-github)].
    2.  **Tesseract OCR:** While permissive, it is demonstrably outperformed by newer models like PaddleOCR-VL and OlmOCR-2, which offer better accuracy and layout preservation [[67](https://www.e2enetworks.com/blog/complete-guide-open-source-ocr-models-2025)].
    3.  **Proprietary APIs (as defaults):** While they offer high accuracy, relying on them by default would violate the "local-first" principle and create a paywalled feature set. They should be considered as optional, pluggable providers in a hybrid mode.