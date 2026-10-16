/**
 * 
 * 
 * fix checked removed on tool changed
 * add an option to disable notifications
 * fix erase
 * fix refresh rate
 * remove drawing tools, etc.
 * board.svg to board.workspace
edit notifications
fix change color in data
undo backup should be controlled from push
add fill tool
keyboard shortcuts notification fix, too many shortcuts
add rotate button 
add only some shape then rotate
add rounding 
fix resets to reset linepoints
board.data.map(item => item.point)
fix notitification messages
undo: 
  board.data = board.data.filter(Boolean)
  save to history array
  on restore redraw board from zero
  no empty lol
  for redo delete history array items after selected verion
  add variable for board history version

 * datatypes:
 * point: {x,y}
 * item: {type, ...}
 * 
 */

/** TODO:
 * 
 * select tool
 * let method params ({x,y})
 * add copyright to svg
 * move notifications to bottom
 
    remove empty //before backup: board.data = board.data.filter(Boolean)

remove the squares behind arch

 *
 * scroll to center fix
 * zoom snap fix
 * block hand scroll if there's nothing drawn
 * dictionary obfuscate
 * old scroll snap zoom snap substraction new scroll
 * onclick board.select() 
 * shapes for drawing
 * copy to illustrator
 * hamza
 * methods should return element to control color then draw using draw to enable dummy element
 * add button to recreate board or return home
 * 
 * 
 * 
 * -- add popup before save showing the old one to confirm saving
 * 
 */

const $ = document.querySelector.bind(document),
  $$ = document.querySelectorAll.bind(document)

const board = {
  svg: $('#kufi'),
  workspace: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  data: [],
  settings: {
    isPainting: false,
    currentTool: 'pen',
    currentColor: 'black',
    lastSavedBoard: 'default', // FIXME: to be removed
    scrolling: {
      is: false,
      startX: 0,
      scrollLeft: 0,
      startY: 0,
      scrollTop: 0
    },
    toBeRemovedElements: [],
    dummy: {},
    archDir: 1,
    drawingShape: 'square',
    linePoints: [],
    set tool(tool) {
      board.settings.currentTool = tool
      if($('[name=arch]:checked') && tool != 'arch') $('[name=arch]:checked').checked = false
      if($('[name=pen]:checked') && tool != 'pen') $('[name=pen]:checked').checked = false
      let container = $('#container')
      if (tool == "hand") {
        container.classList.add('hand')
        board.settings.notify('info', 'اضغط مرتين على اليد للمحاذاة إلى المنتصف')
      } else {
        container.classList.remove('hand')
        board.drawingTools.resets()
      }
      if (tool == 'line') {
        board.settings.notify('info', 'حدد نقطتين مختلفتين للوصل بينهما, لا يُستحسن استخدام هذه الأداة لرسم خطوط عمودية أو أفقية إذ لا يمكن رسم قوس عليها كما أنها تعامل كـ كتلة واحدة عند مسحها. تذكر استخدام الضفائر في تصميمك لجعله أكثر جمالية!')
        board.drawingTools.lines = []
      }
      if (tool == 'eraser') board.settings.notify('info', 'يمكنك الضغط مع السحب لمسح عدة عناصر')
      if (tool == 'pen') board.settings.notify('hint')

      // FIXME: to be changed
      if (tool == 'arch') board.settings.notify('info', 'اختر مربعين لرسم قوس بينهما')

      if (tool != 'arch' || tool == 'arch' && board.settings.dummy.type != 'arch') {
        for (let el of $$('.dummy')) el.remove()
        board.settings.dummy = {}
      }
      if (tool != 'line') board.settings.linePoints = []

      $('[name="tool"]#' + tool).checked = true
    },
    get tool() {
      return board.settings.currentTool
    },
    set color(color) {
      board.settings.currentColor = color
      if (!$('#arch').checked) {
        board.tool = 'pen'
        $('#pen').checked = true
      }
      board.settings.notify('info', 'تم تغيير اللون')
    },
    get color() {
      return board.settings.currentColor
    },

    snap() {
      board.workspace.scrollIntoView({inline: 'center', block: 'center'})
    },
    zoom(dir = 1) {
      let size = board.svg.clientWidth + 400 * dir
      if (size <= 4000 && size >= 800) {
        board.settings.size = size
        board.svg.style.setProperty('--size', size + 'px')
        board.settings.snap()
        board.settings.notify()
      } else {
        board.settings.notify('warn', 'عذرًا، يوجد حدود لمعدل التكبير')
      }
    },
    notify(type = false, text = '') {
      // types: hint, info, warn, null (default)
      let list = [
        'يمكنك دائمًا تغيير لون الكتابة من خلال الضغط على زر الألوان في شريط الأدوات',
        'يمكنك تصدير اللوحة على شكل ملف SVG حيث يمكنك استخدامه في أي برنامج تصميم آخر',
        'تذكر استخدام اختصارات الكيبورد مثل: P لاستخدام القلم، E لاستخدام الممحاة، H لاستخدام اليد، L لرسم خط مستقيم، C لرسم قوس، Ctrl+S للحفظ، Ctrl+Z للتراجع — يمكنك معرفة الاختصار بالوقوف قليلاً فوق الأداة المطلوبة',
        'تم تطوير هذا التطبيق من AbdSattout',
        'يمكنك حفظ اللوحة في التطبيق دون الحاجة لتنزيلها للعودة مرة أخرى واستكمال العمل',
        'نسب الفراغ الافتراضية هي 1:3. يمكنك اختيار الشبكة المنتظمة عند بدء العمل',
        'الخط الكوفي أقدم الخطوط العربية',
        'تذكر أنك تستطيع مسح كل شيء في اللوحة بالضغط مرتين على الممحاة',
        'حافظ على توازن تصميمك، التصميم المتناظر مريح للعين',
        'حاول الالتزام بقواعد الخط الكوفي حتى تكون اللوحة مقروءة',
        'لا تترك فراغات في تصميمك',
        'لا بد من وجود رسالة وراء كل تصميم'
      ]
      switch (type) {
        case 'info':
          $('#notifications').textContent = `👈 ${text}`
          break
        case 'warn':
          $('#notifications').textContent = `⚠️ ${text}`
          break
        case 'hint':
          $('#notifications').textContent = `💡 ${list[Math.round(Math.random() * (list.length - 1))]}`
          break
        default:
          $('#notifications').textContent = ''
          return
      }
      return true
    },
    empty() {
      board.workspace.textContent = ''
      board.settings.notify('info', 'تم إعادة ضبط اللوحة')
      return true
    }
  },
  drawingTools: {
    point(x, y) {
      return board.settings.isMonospaced ? {
        x: Math.ceil(x),
        y: Math.ceil(y)
      } : {
        x: (x - x % 1) * 2 + (x % 1 < 0.75 ? 1 : 2),
        y: (y - y % 1) * 2 + (y % 1 < 0.75 ? 1 : 2)
      }
    },
    save() {
      localStorage.setItem('kq_name', board.settings.name)
      localStorage.setItem('kq_mono', board.settings.isMonospaced)
      localStorage.setItem('kq_size', board.settings.size)
      localStorage.setItem('kq_data', board.svg.innerHTML)
      board.settings.notify('info', 'تم الحفظ في ذاكرة التطبيق')
      return true
    },
    undo() {
      if (board.settings.lastSavedBoard !== 'default') board.svg.innerHTML = board.settings.lastSavedBoard
      else board.settings.notify('info', 'لم ترسم شيئاً بعد')
      board.settings.notify('info', 'تذكر أن التراجع مرة واحدة')
      board.drawingTools.resets()
    },
    backup() {
      // console.log(parent)
      board.settings.lastSavedBoard = board.svg.innerHTML
      return true
    },
    async export(type) {
      switch (type) {
        case 'pdf': {
          let pdf = window.open('')
          let bbox = board.svg.getBBox();
          let viewBox = [bbox.x, bbox.y, bbox.width, bbox.height].join(" ");
          pdf.document.write(`<html><head><title>${board.settings.name}</title>`)
          pdf.document.write('</head><body>')
          pdf.document.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${board.svg.style.width}" height="${board.svg.style.height}" viewBox="${viewBox}">${board.svg.innerHTML}</svg>`)
          pdf.document.write('<style>svg{width:360px;height: 360px;}</style>')
          pdf.document.write('</body></html>')
          pdf.document.close();
          pdf.print()
          pdf.onfocus = () => {
            setTimeout(() => {
              pdf.close()
            }, 500)
          }
          board.settings.notify('info', 'قد لا يعمل التصدير إلى PDF في بعض الأجهزة')
          break
        }
        case 'png': {
          let $a = document.createElement('a')
          $a.href = await convertSVGtoImg()
          $a.setAttribute('download', board.settings.name.replace(/\s/g, '-') + '.png');
          $a.click();
          board.settings.notify()
          break
        }
        default: {
          let $a = document.createElement('a');
          let bbox = board.svg.getBBox()
          $a.setAttribute('href', 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${bbox.width}" height="${bbox.height}" viewBox="${bbox.x},${bbox.y},${bbox.width},${bbox.height}">${board.svg.innerHTML}</svg>`));
          $a.setAttribute('download', board.settings.name.replace(/\s/g, '-') + '.svg');
          $a.click();
          board.settings.notify()
        }
      }
      return true
    },
    draw(items, dummy = false) {
      for (el of $$('.dummy')) el?.remove()
      let elements = []
      if (!Array.isArray(items)) items = [items]
      for (let item of items) {
        let path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        let d = ''
        switch (item.type) {
          case 'shape':
            if (dummy || board.data.map(i => i.point || i.points).flat().filter(point => board.drawingTools.isSamePoint(point, item.point)).length === 0) {
              
              d = board.drawingTools.getPathForShape(item)
              if (!d) return
              path.setAttribute('d', d)
              path.setAttribute('fill', item.fill)
              path.dataset.shape = item.shape
            } else if (board.data.map(i => i.point).filter(point => board.drawingTools.isSamePoint(point, item.point)).length > 0) {
              let shape = board.data.filter(({point}) => board.drawingTools.isSamePoint(point, item.point))[0]
              let index = board.data.indexOf(shape)
              let element = $(`[data-index='${index}']`)
              d = board.drawingTools.getPathForShape(item)
              if (!d) return
              element.setAttribute('d', d)
              element.setAttribute('fill', item.fill)
              element.dataset.shape = item.shape
              board.data[index].shape = item.shape
              board.data[index].fill = item.fill
              return
            }
            break
          case 'arch':
              let radius = board.drawingTools.radius(item.points)
              let [point1, point2] = item.points
              let dir = item.dir
              let {x:x1 ,y:y1, width, height} = board.drawingTools.rectFromPoint(point1)
              let {x:x2, y:y2} = board.drawingTools.rectFromPoint(point2)
              path.setAttribute('stroke-width', width)
              path.setAttribute('stroke', item.stroke)
              path.setAttribute('fill', 'transparent')
              if (x2 > x1 && y1 === y2) {
                path.setAttribute('d', `M ${x1 + 0.5 * width},${y1 + (dir ? height : 0)} A ${radius},${radius} 0 0 ${dir} ${x2 + 0.5 * width},${y2 + (dir ? height : 0)}`)
              } else if (x2 < x1 && y1 === y2) {
                path.setAttribute('d', `M ${x1 + 0.5 * width},${y1 + (dir ? 0 : height)} A ${radius},${radius} 0 0 ${dir} ${x2 + 0.5 * width},${y2 + (dir ? 0 : height)}`)
              } else if (x1 === x2 && y2 > y1) {
                path.setAttribute('d', `M ${x1 + (dir ? 0 : width)},${y1 + 0.5 * height} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? 0 : width)},${y2 + 0.5 * height}`)
              } else if (x1 === x2 && y2 < y1) {
                path.setAttribute('d', `M ${x1 + (dir ? width : 0)},${y1 + 0.5 * height} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? width : 0)},${y2 + 0.5 * height}`)
              } else if (x2 > x1 && y2 > y1) {
                path.setAttribute('d', `M ${x1 + (dir ? 0 : 0.5 * width)},${y1 + (dir ? 0.5 * height : 0)} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? 0.5 * width : width)},${y2 + (dir ? height : 0.5 * height)}`)
              } else if (x2 > x1 && y2 < y1) {
                path.setAttribute('d', `M ${x1 + (dir ? 0.5 * width : 0)},${y1 + (dir ? height : 0.5 * height)} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? width : 0.5 * width)},${y2 + (dir ? 0.5 * height : 0)}`)
              } else if (x2 < x1 && y2 > y1) {
                path.setAttribute('d', `M ${x1 + (dir ? 0.5 * width : width)},${y1 + (dir ? 0 : 0.5 * height)} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? 0 : 0.5 * width)},${y2 + (dir ? 0.5 * height : height)}`)
              } else {
                path.setAttribute('d', `M ${x1 + (dir ? width : 0.5 * width)},${y1 + (dir ? 0.5 * height : height)} A ${radius},${radius} 0 0 ${dir} ${x2 + (dir ? 0.5 * width : 0)},${y2 + (dir ? 0 : 0.5 * height)}`)
              }
            break
          case 'line':
            for (let [index, point] of item.points.entries()) {
              let {x, y, width, height} = board.drawingTools.rectFromPoint(point)
              let z = board.drawingTools.isSamePoint(item.points[0], item.points[item.points.length - 1])
              if (index === 0 || index === item.points.length - 1) {
                let {x:x1, y:y1} = board.drawingTools.rectFromPoint(item.points[index === 0 ? index : index - 1])
                let {x:x2, y:y2} = board.drawingTools.rectFromPoint(item.points[index === 0 ? index + 1 : index])
                let dx = x2 - x1
                let dy = y2 - y1
                if(dx && !dy && !z) {
                  if (dx > 0) {
                    x -= (index === 0 ? +1 : -1) * 0.5 * width
                  } else {
                    x += (index === 0 ? +1 : -1) * 0.5 * width
                  }
                }
                if (dy && !dx && !z) {
                  if (dy > 0) {
                    y -= (index === 0 ? +1 : -1) * 0.5 * height
                  } else {
                    y += (index === 0 ? +1 : -1) * 0.5 * height
                  }                  
                }
                d += (index === item.points.length - 1 && z ? 'Z' : `${index === 0 ? 'M' : 'L'} ${x + 0.5 * width},${y + 0.5 * height}`)
              } else {
                d += ` L ${x + 0.5 * width},${y + 0.5 * height} `
              }
            }
            path.setAttribute('d', d)
            path.setAttribute('stroke', item.stroke)
            path.setAttribute('stroke-width', board.settings.isMonospaced ? 1 : 0.75)
            path.setAttribute('fill', 'transparent')
            break
          }
          if (dummy) path.classList.add('dummy')
          board.workspace.appendChild(path)
          elements.push(path)
        }
      return elements.length === 1 ? elements[0] : elements
    },
    shape(point, isRect = false) {
      return {
        type: 'shape',
        point: point,
        fill: board.settings.color,
        shape: isRect ? 'square' : board.settings.drawingShape
      }
    },
    getPathForShape(item) {
      let rect = board.drawingTools.rectFromPoint(item.point)
      let d
      switch (item.shape) {
        // do not forget z
        default:
          let {x, y, width, height} = rect
          d = `M ${x},${y} L ${x + width},${y} L ${x + width},${y + height} L ${x},${y + height} Z`
          break
      }
      return d
    },
    arch(point1, point2) {
      return {
        type: 'arch',
        points: [point1, point2],
        dir: board.settings.archDir,
        stroke: board.settings.color
      }
    },
    radius([point1, point2]) {
      let radius
      let [rect1, rect2] = [board.drawingTools.rectFromPoint(point1), board.drawingTools.rectFromPoint(point2)]
      let [x1, y1, x2, y2] = [rect1.x, rect1.y, rect2.x, rect2.y]
      let dx = Math.abs(x2 - x1)
      let dy = Math.abs(y2 - y1)
      if (dy === dx && dx !== 0) radius = dx + (board.settings.isMonospaced ? 0.5 : 0.375)
      if (!((dy && dx) && (dy || dx))) radius = (dy || dx) / 2
      return radius
    },
    line(points) {
      if (points.length < 2) return {
        type: 'shape',
        point: points[0],
        fill: board.settings.color,
        shape: 'square' // fixme to be reviewed
      }
      else if (points.length === 2 && (points[0].x === points[1].x || points[0].y === points[1].y)) {
        let dx = points[1].x - points[0].x
        let dy = points[1].y - points[0].y
        let m = n = Math.abs(dx || dy) + 1
        let rects = []
        let point = dx ? (dx > 0 ? points[0] : points[1]) : (dy > 0 ? points[0] : points[1])
        while (n > 0) {
          if (dx) rects.push({
            type: 'shape',
            point: {x: point.x + m - n, y: point.y},
            fill: board.settings.color,
            shape: 'square' // fixme to be reviewed
          })
          else rects.push({
            type: 'shape',
            point: {x: point.x, y: point.y + m - n},
            fill: board.settings.color,
            shape: 'square' // fixme to be reviewed
          })
          n--
        }
        return rects
      } else return {
        type: 'line',
        points: points,
        stroke: board.settings.color
      }
    },
    push(items) {
      let elements = []
      if (!Array.isArray(items)) items = [items]
      for (let item of items) {
        let el = board.drawingTools.draw(item)
        if (el && (Array.isArray(el) ? el.length > 0 : true)) {
          el.dataset.index = board.data.length
          board.data.push(item)
          elements.push(item)
        }
      }
      return elements.length === 1 ? elements[0] : elements
    },
    rectFromPoint({ x, y }) {
      return board.settings.isMonospaced ? {
        x: x - 1,
        y: y - 1,
        width: 1,
        height: 1
      } : {
        x: (x % 2 === 0 ? x - 2 : x - 1) / 2 + (x % 2 === 0 ? 0.75 : 0),
        y: (y % 2 === 0 ? y - 2 : y - 1) / 2 + (y % 2 === 0 ? 0.75 : 0),
        width: x % 2 === 1 ? 0.75 : 0.25,
        height: y % 2 === 1 ? 0.75 : 0.25
      }
    },
    isMainRect(point) {
      let rect = board.drawingTools.rectFromPoint(point)
      return rect.width === rect.height && rect.width !== 0.25
    },
    isSamePoint(point1, point2) {
      return point1.x === point2.x && point1.y === point2.y
    },
    changeColor(el) {
      el.setAttribute('fill', board.settings.color)
      return true
    },
    removeHidden() {
      if (board.settings.toBeRemovedElements.length > 0) board.drawingTools.backup()
      board.settings.toBeRemovedElements.forEach(el => el.remove())
      board.settings.notify()
      return true
    },
    hide(el) {
      if (el.getAttribute('stroke'))
        el.setAttribute('style', 'stroke:lightpink')
      else
        el.setAttribute('style', 'fill:lightpink')
      board.settings.toBeRemovedElements.push(el)
      return true
    },
    resets(empty = true) {
      document.querySelectorAll('svg *[style]').forEach(el => {
        el.style.fill == 'tomato' ? el.remove() : el.removeAttribute('style')
      })
      // FIXME: to be removed
      board._archs = []
      if (empty) board.drawingTools.lines = []
      return true
    },
  },
  init(name, isMonospaced, restoreFromLocalStorage = false) {
    board.settings.name = restoreFromLocalStorage ? localStorage.getItem('kq_name') : name.replace(/[/\\?%*:|"<>،]/g, ' ').replace(/\s\s+/g, ' ').trim()
    board.settings.isMonospaced = restoreFromLocalStorage ? localStorage.getItem('kq_mono') === 'true' : isMonospaced
    board.settings.size = restoreFromLocalStorage ? localStorage.getItem('kq_size') : 3200
    if (restoreFromLocalStorage) board.svg.innerHTML = localStorage.getItem('kq_data')
    board.svg.style.setProperty('--size', board.settings.size + 'px')
    document.title = `KufiCraft - ${board.settings.name}`
    $('#container').classList.remove('hidden')
    $('#create').classList.add('hidden')
    $('#popup').onclick = e => {
      e.stopPropagation()
      e.target.id === 'popup' && e.target.classList.add('hidden')
    }
    $('#container').scrollTo({
      top: 1600 - innerHeight / 2,
      left: innerWidth / 2 - 1600
    })
    board.settings.isMonospaced && board.svg.classList.add('mono')
    board.svg.querySelectorAll('g').forEach(el => el.remove())
    board.svg.appendChild(board.workspace)

    $('#toolbar').classList.remove('hidden')

    board.svg.addEventListener('touchstart', e => {
      board.settings.toBeRemovedElements = []
      if (board.settings.tool == 'pen') board.drawingTools.backup()
      board.settings.isPainting = true
    }, { passive: true })

    board.svg.addEventListener('mousedown', e => {
      e.preventDefault()

      let el = document.elementFromPoint(e.clientX, e.clientY)
      let pt = new DOMPoint(e.clientX, e.clientY);
      let {x:x, y:y} = pt.matrixTransform(board.svg.getScreenCTM().inverse())

      // FIXME: add !
      if (window.installerEvenetHadBeenCalled) {
        window.installer.prompt()
        window.installerEvenetHadBeenCalled = true
      }
      board.settings.toBeRemovedElements = []
      if (!board.settings.isPainting) {
        if (board.settings.tool == 'pen') {
          board.drawingTools.push(board.drawingTools.shape(board.drawingTools.point(x, y)))
        }

        // fixme: to be removed
        if (el.parentElement?.id == 'kufi' && board.settings.tool == 'eraser') {
          board.drawingTools.hide(el)
        }

        if (board.settings.tool == 'line') {
          if (board.drawingTools.isMainRect(board.drawingTools.point(x, y))) {
            if (board.settings.linePoints.length > 1
              && (board.drawingTools.isSamePoint(board.settings.linePoints[0], board.drawingTools.point(x, y))
              || board.drawingTools.isSamePoint(board.drawingTools.point(x, y), board.settings.linePoints[board.settings.linePoints.length - 1]))) {
                if (board.drawingTools.isSamePoint(board.settings.linePoints[0], board.drawingTools.point(x, y)))
                  board.settings.linePoints.push(board.drawingTools.point(x, y))

                board.drawingTools.push(board.drawingTools.line(board.settings.linePoints))
                board.settings.linePoints = []
              } else {
                board.settings.linePoints.push(board.drawingTools.point(x, y))
                board.drawingTools.draw(board.drawingTools.line(board.settings.linePoints), true)
            }
          }
        }
        if (board.settings.tool == 'arch') {
          if (!board.settings.dummy.type) {
            let rect = board.drawingTools.rectFromPoint(board.drawingTools.point(x, y))
            if (board.drawingTools.isMainRect(board.drawingTools.point(x, y))) {
              rect = board.drawingTools.shape(board.drawingTools.point(x, y), true)
              board.settings.dummy = rect
              board.drawingTools.draw(rect, true)
            }
          }
        }
        if (board.settings.tool == 'hand') {
          board.settings.scrolling.is = true
          board.settings.scrolling.startX = e.pageX - $('#container').offsetLeft;
          board.settings.scrolling.scrollLeft = $('#container').scrollLeft
          board.settings.scrolling.startY = e.pageY - $('#container').offsetTop;
          board.settings.scrolling.scrollTop = $('#container').scrollTop
        }
      }
      board.settings.isPainting = true
    })

    board.svg.addEventListener('touchmove', e => {

      let el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)
      let pt = new DOMPoint(e.touches[0].clientX, e.touches[0].clientY);
      let {x:x, y:y} = pt.matrixTransform(board.svg.getScreenCTM().inverse())
      if (el.id == 'kufi' && board.settings.tool == 'pen') board.drawingTools.push(board.drawingTools.shape(board.drawingTools.point(x, y)))
      if (el.parentElement?.id == 'kufi' && board.settings.tool == 'pen') board.drawingTools.changeColor(el)
      if (el.parentElement?.id == 'kufi' && board.settings.tool == 'eraser') board.drawingTools.hide(el)
    }, { passive: true })

    board.svg.addEventListener('mousemove', e => {
      e.preventDefault()

      let el = document.elementFromPoint(e.clientX, e.clientY)
      let pt = new DOMPoint(e.clientX, e.clientY);
      let {x:x, y:y} = pt.matrixTransform(board.svg.getScreenCTM().inverse())

      if (board.settings.scrolling.is) {
        const x = e.pageX - $('#container').offsetLeft;
        const walkX = (x - board.settings.scrolling.startX);
        $('#container').scrollLeft = board.settings.scrolling.scrollLeft - walkX;
        const y = e.pageY - $('#container').offsetTop;
        const walkY = (y - board.settings.scrolling.startY);
        $('#container').scrollTop = board.settings.scrolling.scrollTop - walkY;
      } else if (board.settings.isPainting && el) {
        if (board.settings.tool == 'pen') board.drawingTools.push(board.drawingTools.shape(board.drawingTools.point(x, y)))
        //fixme
        if (el.parentElement?.id == 'kufi' && board.settings.tool == 'eraser') board.drawingTools.hide(el)
      }
      if (board.settings.tool == 'arch' && board.settings.dummy.type && board.drawingTools.isMainRect(board.drawingTools.point(x, y)) && !board.drawingTools.isSamePoint(board.drawingTools.point(x, y), board.settings.dummy.point || board.settings.dummy.points[1])) {
        if (board.settings.dummy.type != 'arch') {
          board.settings.dummy = board.drawingTools.arch(board.drawingTools.point(x, y), board.settings.dummy.point)
        } else if (board.drawingTools.radius([board.drawingTools.point(x, y), board.settings.dummy.points[1]])) {
          board.settings.dummy = board.drawingTools.arch(board.drawingTools.point(x, y), board.settings.dummy.points[1])
        }
        if (board.settings.dummy.points && board.drawingTools.radius(board.settings.dummy.points)) {
          board.drawingTools.draw(board.settings.dummy, true)
        }
      }
      if (board.settings.tool == 'line' && board.settings.linePoints.length > 0 && board.drawingTools.isMainRect(board.drawingTools.point(x, y))) {
        if (board.drawingTools.isSamePoint(board.settings.linePoints[board.settings.linePoints.length - 1], board.drawingTools.point(x, y)))
        board.drawingTools.draw(board.drawingTools.line(board.settings.linePoints), true)
        else
        board.drawingTools.draw(board.drawingTools.line([...board.settings.linePoints, board.drawingTools.point(x, y)]), true)
      }
    })

    board.svg.addEventListener('touchend', e => {
      board.settings.isPainting = false
      if (board.settings.tool == 'eraser') board.drawingTools.removeHidden()
    }, { passive: true })

    board.svg.addEventListener('mouseup', e => {
      e.preventDefault()
      let el = document.elementFromPoint(e.clientX, e.clientY)
      let pt = new DOMPoint(e.clientX, e.clientY);
      let {x:x, y:y} = pt.matrixTransform(board.svg.getScreenCTM().inverse())
      board.settings.isPainting = false
      if (board.settings.tool == 'eraser') board.drawingTools.removeHidden()
      if (board.settings.tool == 'arch' && board.settings.dummy.type == 'arch') {
        board.drawingTools.push(board.settings.dummy)
        for (el of $$('.dummy')) el?.remove()
        board.settings.dummy = {}
        board.settings.notify()
      } else if (board.settings.tool == 'arch' && board.settings.dummy.type && board.drawingTools.isMainRect(board.drawingTools.point(x, y)) && !board.drawingTools.isSamePoint(board.drawingTools.point(x, y), board.settings.dummy.point || board.settings.dummy.points[1])) {
        if (board.settings.dummy.type != 'arch') {
          board.settings.dummy = board.drawingTools.arch(board.drawingTools.point(x, y), board.settings.dummy.point)
        } else if (board.drawingTools.radius([board.drawingTools.point(x, y), board.settings.dummy.points[1]])) {
          board.settings.dummy = board.drawingTools.arch(board.drawingTools.point(x, y), board.settings.dummy.points[1])
        }
        if (board.settings.dummy.points && board.drawingTools.radius(board.settings.dummy.points)) {
          board.drawingTools.draw(board.settings.dummy, true)
        }
      }
      board.settings.scrolling.is = false
    })

    window.addEventListener("keydown", e => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        $('#popup').classList.remove('hidden')
      }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        board.drawingTools.undo()
      }
      if (e.key === 'h') { board.settings.tool = 'hand'; e.preventDefault() }
      if (e.key === 'p') { board.settings.tool = 'pen'; e.preventDefault() }
      if (e.key === 'e') { board.settings.tool = 'eraser'; e.preventDefault() }
      if (e.key === 'l') { board.settings.tool = 'line'; e.preventDefault() }
      if (e.key === 'c') { board.settings.tool = 'arch'; board.settings.archDir = 1; $('#overclockwise').checked = true; e.preventDefault() }
    });

  }
}

// FIXME:
Object.freeze(board)

const create = (restoreFromLocalStorage = false) => {
  let name = $('#name').value
  let isMonospaced = $('#mono').checked
  board.init(name, isMonospaced, restoreFromLocalStorage)
  //window.onerror = err => board.settings.notify('warn', err)
  if (restoreFromLocalStorage) {
    board.settings.notify('info', 'تم استعادة اللوحة من ذاكرة التطبيق')
    board.settings.snap()
  }
}

onload = () => {
  $('.loader').remove()
  $('#create button[disabled]').removeAttribute('disabled')
  if (localStorage.getItem('kq_name') && localStorage.getItem('kq_mono') && localStorage.getItem('kq_data')) {
    $('#restore').removeAttribute('hidden')
    if (location.hash === '#restore') create(true)
  }
}

const loadImage = async url => {
  const $img = document.createElement('img')
  $img.src = url
  return new Promise((resolve, reject) => {
    $img.onload = () => resolve($img)
    $img.onerror = reject
  })
}

const convertSVGtoImg = async e => {
  const $svg = board.svg
  const format = 'png'
  const bbox = board.svg.getBBox()

  const svgAsXML = (new XMLSerializer()).serializeToString($svg)
  const svgData = `data:image/svg+xml,${encodeURIComponent(svgAsXML)}`

  const img = await loadImage(svgData)

  let $canvas = document.createElement('canvas')
  $canvas.width = $svg.clientWidth
  $canvas.height = $svg.clientHeight
  let ctx = $canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, $svg.clientWidth, $svg.clientHeight)
  let imageData = ctx.getImageData(bbox.x * $svg.clientWidth / 100, bbox.y * $svg.clientHeight / 100, bbox.width * $svg.clientWidth / 100, bbox.height * $svg.clientHeight / 100)
  $canvas = document.createElement('canvas')
  $canvas.width = bbox.width * $svg.clientWidth / 100
  $canvas.height = bbox.height * $svg.clientHeight / 100
  ctx = $canvas.getContext("2d")
  ctx.putImageData(imageData, 0, 0)

  const dataURL = await $canvas.toDataURL(`image/${format}`, 1.0)


  return dataURL
}

// FIXME: to be removed
board.init('', false, false)