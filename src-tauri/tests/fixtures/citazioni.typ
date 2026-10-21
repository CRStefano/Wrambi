// Generato da Wrambi. Compilabile con Typst (anche dentro Wrambi).
#set document(title: "Saggio")
#set page(paper: "a4", margin: 2.5cm)
#set text(lang: "it", font: "Libertinus Serif", size: 11pt)
#set par(justify: true, leading: 0.7em)
#set heading(numbering: none)
#show heading: set block(above: 1.4em, below: 0.8em)
#show link: underline

= Saggio

Secondo #cite(label("bianchi2019"), form: "prose"), il tempo vedi #cite(label("rossi2020"), supplement: [p. 12]) #cite(label("oms2021")) è #strong[misurabile] (#cite(label("rossi2020b"), form: "year")).

Una chiave ignota \[\@ignoto\] resta testo.

#bibliography("wrambi-citazioni.bib", style: "chicago-author-date")
