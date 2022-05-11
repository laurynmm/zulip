from bs4 import BeautifulSoup

from zerver.lib.templates import render_markdown_path

# First iteration is using the pure_markdown = True
# to read the file with includes / relative links.

# The sidebar, header and footer content aren't
# rendered b/c there is no template or context.

# Possibly worth writing a modified version?
def render_html(file_path: str) -> str:

    html = render_markdown_path(file_path, pure_markdown=True)

    return html


# from https://www.geeksforgeeks.org/remove-all-style-scripts-and-html-tags-using-beautifulsoup/
def remove_tags(html: str) -> str:

    # parse html content
    soup = BeautifulSoup(html, "html.parser")

    for data in soup(["style", "script"]):
        # Remove tags
        data.decompose()

    # return data by retrieving the tag content
    return " ".join(soup.stripped_strings)
