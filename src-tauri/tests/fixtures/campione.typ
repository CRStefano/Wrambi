// Generato da Wrambi. Compilabile con Typst (anche dentro Wrambi).
#set document(title: "Saggio sul tempo")
#set page(paper: "a4", margin: 2.5cm)
#set text(lang: "it", font: "Libertinus Serif", size: 11pt)
#set par(justify: true, leading: 0.7em)
#set heading(numbering: none)
#show heading: set block(above: 1.4em, below: 0.8em)
#show link: underline

= Saggio sul tempo

Un paragrafo con #strong[grassetto], #emph[corsivo], #underline[sottolineato] e #strike[barrato];.
Contiene anche #raw("codice"), un #link("https://example.org")[collegamento] e caratteri speciali: 50% & 3 \$ \#tag #emph[x] a\_b c#emph[d {graffe} \~tilde\~ \"virgolette\" \<angoli\> \@nome \/\/ non commento \/] nemmeno \*\/ \\ barra.

== Elenchi

- primo punto
- secondo punto con #strong[enfasi]

  - annidato
- terzo

3. tre
4. quattro

#quote(block: true)[
Una citazione
su due righe.

Secondo paragrafo della citazione.
]

```python
def f(x):
    return x * 2  # commento
```

#line(length: 100%, stroke: 0.5pt + luma(180))

#table(
  columns: 3,
  align: (left, center, right),
  table.header([Autore], [Anno], [Pagine]),
  [Kant], [1781], [856],
  [Hume], [1739], [400],
)

=== Casi limite

\= non è un titolo

- non è elenco? sì, lo è.

1\. numero non elenco

Riga con a capo forzato \
seconda riga.

#strong[Nota];.Seguita da punto e (parentesi) dopo #emph[enfasi];(qui).
