"""Team name mapping matrix for cross-source normalization.

Each team has a canonical name and source-specific names for:
  - Torvik (barttorvik.com)
  - NCAA API (ncaa-api.henrygd.me)
  - Odds API (the-odds-api.com)

The `seed_teams()` function inserts all mapped teams into the database.
The `resolve_team_id()` function finds a team_id from any source name.

To add new mappings:
  1. Add entry to TEAM_MAP with (canonical, conference, torvik, ncaa, odds_api)
  2. Run `python -m ingest.team_mappings` to re-seed
"""

from __future__ import annotations

from db.database import DatabaseManager
from db.queries import upsert_team, find_team_id

# (canonical_name, conference, torvik_name, ncaa_name, odds_api_name)
# Sorted alphabetically by canonical name
TEAM_MAP: list[tuple[str, str, str, str, str]] = [
    # ── A ────────────────────────────────────────────────────
    ("Abilene Christian", "WAC", "Abilene Christian", "Abilene Christian", "Abilene Christian Wildcats"),
    ("Air Force", "MWC", "Air Force", "Air Force", "Air Force Falcons"),
    ("Akron", "MAC", "Akron", "Akron", "Akron Zips"),
    ("Alabama", "SEC", "Alabama", "Alabama", "Alabama Crimson Tide"),
    ("Alabama A&M", "SWAC", "Alabama A&M", "Alabama A&M", "Alabama A&M Bulldogs"),
    ("Alabama State", "SWAC", "Alabama St.", "Alabama State", "Alabama State Hornets"),
    ("Albany", "AE", "Albany", "Albany", "Albany Great Danes"),
    ("Alcorn State", "SWAC", "Alcorn St.", "Alcorn State", "Alcorn State Braves"),
    ("American", "Patriot", "American", "American", "American Eagles"),
    ("Appalachian State", "Sun Belt", "Appalachian St.", "Appalachian State", "Appalachian State Mountaineers"),
    ("Arizona", "Big 12", "Arizona", "Arizona", "Arizona Wildcats"),
    ("Arizona State", "Big 12", "Arizona St.", "Arizona State", "Arizona State Sun Devils"),
    ("Arkansas", "SEC", "Arkansas", "Arkansas", "Arkansas Razorbacks"),
    ("Arkansas Pine Bluff", "SWAC", "Ark. Pine Bluff", "Arkansas-Pine Bluff", "Arkansas-Pine Bluff Golden Lions"),
    ("Arkansas State", "Sun Belt", "Arkansas St.", "Arkansas State", "Arkansas State Red Wolves"),
    ("Army", "Patriot", "Army", "Army West Point", "Army Black Knights"),
    ("Auburn", "SEC", "Auburn", "Auburn", "Auburn Tigers"),
    ("Austin Peay", "ASUN", "Austin Peay", "Austin Peay", "Austin Peay Governors"),

    # ── B ────────────────────────────────────────────────────
    ("Ball State", "MAC", "Ball St.", "Ball State", "Ball State Cardinals"),
    ("Baylor", "Big 12", "Baylor", "Baylor", "Baylor Bears"),
    ("Bellarmine", "ASUN", "Bellarmine", "Bellarmine", "Bellarmine Knights"),
    ("Belmont", "MVC", "Belmont", "Belmont", "Belmont Bruins"),
    ("Bethune-Cookman", "SWAC", "Bethune Cookman", "Bethune-Cookman", "Bethune-Cookman Wildcats"),
    ("Binghamton", "AE", "Binghamton", "Binghamton", "Binghamton Bearcats"),
    ("Boise State", "MWC", "Boise St.", "Boise State", "Boise State Broncos"),
    ("Boston College", "ACC", "Boston College", "Boston College", "Boston College Eagles"),
    ("Boston University", "Patriot", "Boston University", "Boston U.", "Boston University Terriers"),
    ("Bowling Green", "MAC", "Bowling Green", "Bowling Green", "Bowling Green Falcons"),
    ("Bradley", "MVC", "Bradley", "Bradley", "Bradley Braves"),
    ("Brown", "Ivy", "Brown", "Brown", "Brown Bears"),
    ("Bryant", "AE", "Bryant", "Bryant", "Bryant Bulldogs"),
    ("Bucknell", "Patriot", "Bucknell", "Bucknell", "Bucknell Bison"),
    ("Buffalo", "MAC", "Buffalo", "Buffalo", "Buffalo Bulls"),
    ("Butler", "Big East", "Butler", "Butler", "Butler Bulldogs"),
    ("BYU", "Big 12", "BYU", "BYU", "BYU Cougars"),

    # ── C ────────────────────────────────────────────────────
    ("Cal Baptist", "WAC", "Cal Baptist", "California Baptist", "Cal Baptist Lancers"),
    ("Cal Poly", "Big West", "Cal Poly", "Cal Poly", "Cal Poly Mustangs"),
    ("Cal State Bakersfield", "Big West", "Cal St. Bakersfield", "CSU Bakersfield", "Cal State Bakersfield Roadrunners"),
    ("Cal State Fullerton", "Big West", "Cal St. Fullerton", "Cal State Fullerton", "Cal State Fullerton Titans"),
    ("Cal State Northridge", "Big West", "Cal St. Northridge", "CSUN", "Cal State Northridge Matadors"),
    ("California", "ACC", "California", "California", "California Golden Bears"),
    ("Campbell", "CAA", "Campbell", "Campbell", "Campbell Fighting Camels"),
    ("Canisius", "MAAC", "Canisius", "Canisius", "Canisius Golden Griffins"),
    ("Central Arkansas", "ASUN", "Central Arkansas", "Central Arkansas", "Central Arkansas Bears"),
    ("Central Connecticut", "NEC", "Central Conn.", "Central Connecticut", "Central Connecticut Blue Devils"),
    ("Central Michigan", "MAC", "Central Michigan", "Central Michigan", "Central Michigan Chippewas"),
    ("Charleston", "CAA", "Charleston", "Charleston", "Charleston Cougars"),
    ("Charleston Southern", "Big South", "Charleston Southern", "Charleston Southern", "Charleston Southern Buccaneers"),
    ("Charlotte", "AAC", "Charlotte", "Charlotte", "Charlotte 49ers"),
    ("Chattanooga", "SoCon", "Chattanooga", "Chattanooga", "Chattanooga Mocs"),
    ("Chicago State", "NEC", "Chicago St.", "Chicago State", "Chicago State Cougars"),
    ("Cincinnati", "Big 12", "Cincinnati", "Cincinnati", "Cincinnati Bearcats"),
    ("Clemson", "ACC", "Clemson", "Clemson", "Clemson Tigers"),
    ("Cleveland State", "Horizon", "Cleveland St.", "Cleveland State", "Cleveland State Vikings"),
    ("Coastal Carolina", "Sun Belt", "Coastal Carolina", "Coastal Carolina", "Coastal Carolina Chanticleers"),
    ("Colgate", "Patriot", "Colgate", "Colgate", "Colgate Raiders"),
    ("Colorado", "Big 12", "Colorado", "Colorado", "Colorado Buffaloes"),
    ("Colorado State", "MWC", "Colorado St.", "Colorado State", "Colorado State Rams"),
    ("Columbia", "Ivy", "Columbia", "Columbia", "Columbia Lions"),
    ("Connecticut", "Big East", "Connecticut", "UConn", "Connecticut Huskies"),
    ("Coppin State", "MEAC", "Coppin St.", "Coppin State", "Coppin State Eagles"),
    ("Cornell", "Ivy", "Cornell", "Cornell", "Cornell Big Red"),
    ("Creighton", "Big East", "Creighton", "Creighton", "Creighton Bluejays"),

    # ── D ────────────────────────────────────────────────────
    ("Dartmouth", "Ivy", "Dartmouth", "Dartmouth", "Dartmouth Big Green"),
    ("Davidson", "A-10", "Davidson", "Davidson", "Davidson Wildcats"),
    ("Dayton", "A-10", "Dayton", "Dayton", "Dayton Flyers"),
    ("Delaware", "CAA", "Delaware", "Delaware", "Delaware Blue Hens"),
    ("Delaware State", "MEAC", "Delaware St.", "Delaware State", "Delaware State Hornets"),
    ("Denver", "Summit", "Denver", "Denver", "Denver Pioneers"),
    ("DePaul", "Big East", "DePaul", "DePaul", "DePaul Blue Demons"),
    ("Detroit Mercy", "Horizon", "Detroit", "Detroit Mercy", "Detroit Mercy Titans"),
    ("Drake", "MVC", "Drake", "Drake", "Drake Bulldogs"),
    ("Drexel", "CAA", "Drexel", "Drexel", "Drexel Dragons"),
    ("Duke", "ACC", "Duke", "Duke", "Duke Blue Devils"),
    ("Duquesne", "A-10", "Duquesne", "Duquesne", "Duquesne Dukes"),

    # ── E ────────────────────────────────────────────────────
    ("East Carolina", "AAC", "East Carolina", "East Carolina", "East Carolina Pirates"),
    ("East Texas A&M", "Southland", "East Texas A&M", "East Texas A&M", "East Texas A&M Lions"),
    ("East Tennessee State", "SoCon", "East Tennessee St.", "East Tennessee State", "East Tennessee State Buccaneers"),
    ("Eastern Illinois", "OVC", "Eastern Illinois", "Eastern Illinois", "Eastern Illinois Panthers"),
    ("Eastern Kentucky", "ASUN", "Eastern Kentucky", "Eastern Kentucky", "Eastern Kentucky Colonels"),
    ("Eastern Michigan", "MAC", "Eastern Michigan", "Eastern Michigan", "Eastern Michigan Eagles"),
    ("Eastern Washington", "Big Sky", "Eastern Washington", "Eastern Washington", "Eastern Washington Eagles"),
    ("Elon", "CAA", "Elon", "Elon", "Elon Phoenix"),
    ("Evansville", "MVC", "Evansville", "Evansville", "Evansville Purple Aces"),

    # ── F ────────────────────────────────────────────────────
    ("Fairfield", "MAAC", "Fairfield", "Fairfield", "Fairfield Stags"),
    ("Fairleigh Dickinson", "NEC", "Fairleigh Dickinson", "Fairleigh Dickinson", "Fairleigh Dickinson Knights"),
    ("Florida", "SEC", "Florida", "Florida", "Florida Gators"),
    ("Florida A&M", "SWAC", "Florida A&M", "Florida A&M", "Florida A&M Rattlers"),
    ("Florida Atlantic", "AAC", "Florida Atlantic", "Florida Atlantic", "Florida Atlantic Owls"),
    ("Florida Gulf Coast", "ASUN", "Florida Gulf Coast", "Florida Gulf Coast", "Florida Gulf Coast Eagles"),
    ("Florida International", "CUSA", "FIU", "FIU", "FIU Panthers"),
    ("Florida State", "ACC", "Florida St.", "Florida State", "Florida State Seminoles"),
    ("Fordham", "A-10", "Fordham", "Fordham", "Fordham Rams"),
    ("Fresno State", "MWC", "Fresno St.", "Fresno State", "Fresno State Bulldogs"),
    ("Furman", "SoCon", "Furman", "Furman", "Furman Paladins"),

    # ── G ────────────────────────────────────────────────────
    ("Gardner-Webb", "Big South", "Gardner Webb", "Gardner-Webb", "Gardner-Webb Runnin' Bulldogs"),
    ("George Mason", "A-10", "George Mason", "George Mason", "George Mason Patriots"),
    ("George Washington", "A-10", "George Washington", "George Washington", "George Washington Revolutionaries"),
    ("Georgetown", "Big East", "Georgetown", "Georgetown", "Georgetown Hoyas"),
    ("Georgia", "SEC", "Georgia", "Georgia", "Georgia Bulldogs"),
    ("Georgia Southern", "Sun Belt", "Georgia Southern", "Georgia Southern", "Georgia Southern Eagles"),
    ("Georgia State", "Sun Belt", "Georgia St.", "Georgia State", "Georgia State Panthers"),
    ("Georgia Tech", "ACC", "Georgia Tech", "Georgia Tech", "Georgia Tech Yellow Jackets"),
    ("Gonzaga", "WCC", "Gonzaga", "Gonzaga", "Gonzaga Bulldogs"),
    ("Grambling State", "SWAC", "Grambling St.", "Grambling", "Grambling Tigers"),
    ("Grand Canyon", "WAC", "Grand Canyon", "Grand Canyon", "Grand Canyon Antelopes"),
    ("Green Bay", "Horizon", "Green Bay", "Green Bay", "Green Bay Phoenix"),

    # ── H ────────────────────────────────────────────────────
    ("Hampton", "CAA", "Hampton", "Hampton", "Hampton Pirates"),
    ("Hartford", "AE", "Hartford", "Hartford", "Hartford Hawks"),
    ("Harvard", "Ivy", "Harvard", "Harvard", "Harvard Crimson"),
    ("Hawaii", "Big West", "Hawaii", "Hawai'i", "Hawaii Rainbow Warriors"),
    ("High Point", "Big South", "High Point", "High Point", "High Point Panthers"),
    ("Hofstra", "CAA", "Hofstra", "Hofstra", "Hofstra Pride"),
    ("Holy Cross", "Patriot", "Holy Cross", "Holy Cross", "Holy Cross Crusaders"),
    ("Houston", "Big 12", "Houston", "Houston", "Houston Cougars"),
    ("Houston Christian", "Southland", "Houston Christian", "Houston Christian", "Houston Christian Huskies"),
    ("Howard", "MEAC", "Howard", "Howard", "Howard Bison"),

    # ── I ────────────────────────────────────────────────────
    ("Idaho", "Big Sky", "Idaho", "Idaho", "Idaho Vandals"),
    ("Idaho State", "Big Sky", "Idaho St.", "Idaho State", "Idaho State Bengals"),
    ("Illinois", "Big Ten", "Illinois", "Illinois", "Illinois Fighting Illini"),
    ("Illinois Chicago", "Horizon", "Illinois Chicago", "UIC", "UIC Flames"),
    ("Illinois State", "MVC", "Illinois St.", "Illinois State", "Illinois State Redbirds"),
    ("Incarnate Word", "Southland", "Incarnate Word", "Incarnate Word", "Incarnate Word Cardinals"),
    ("Indiana", "Big Ten", "Indiana", "Indiana", "Indiana Hoosiers"),
    ("Indiana State", "MVC", "Indiana St.", "Indiana State", "Indiana State Sycamores"),
    ("Iona", "MAAC", "Iona", "Iona", "Iona Gaels"),
    ("Iowa", "Big Ten", "Iowa", "Iowa", "Iowa Hawkeyes"),
    ("Iowa State", "Big 12", "Iowa St.", "Iowa State", "Iowa State Cyclones"),
    ("IU Indianapolis", "Horizon", "IU Indy", "IU Indianapolis", "IU Indianapolis Jaguars"),

    # ── J ────────────────────────────────────────────────────
    ("Jackson State", "SWAC", "Jackson St.", "Jackson State", "Jackson State Tigers"),
    ("Jacksonville", "ASUN", "Jacksonville", "Jacksonville", "Jacksonville Dolphins"),
    ("Jacksonville State", "CUSA", "Jacksonville St.", "Jacksonville State", "Jacksonville State Gamecocks"),
    ("James Madison", "Sun Belt", "James Madison", "James Madison", "James Madison Dukes"),

    # ── K ────────────────────────────────────────────────────
    ("Kansas", "Big 12", "Kansas", "Kansas", "Kansas Jayhawks"),
    ("Kansas City", "Summit", "UMKC", "Kansas City", "Kansas City Roos"),
    ("Kansas State", "Big 12", "Kansas St.", "Kansas State", "Kansas State Wildcats"),
    ("Kennesaw State", "CUSA", "Kennesaw St.", "Kennesaw State", "Kennesaw State Owls"),
    ("Kent State", "MAC", "Kent St.", "Kent State", "Kent State Golden Flashes"),
    ("Kentucky", "SEC", "Kentucky", "Kentucky", "Kentucky Wildcats"),

    # ── L ────────────────────────────────────────────────────
    ("La Salle", "A-10", "La Salle", "La Salle", "La Salle Explorers"),
    ("Lafayette", "Patriot", "Lafayette", "Lafayette", "Lafayette Leopards"),
    ("Lamar", "Southland", "Lamar", "Lamar", "Lamar Cardinals"),
    ("Le Moyne", "NEC", "Le Moyne", "Le Moyne", "Le Moyne Dolphins"),
    ("Lehigh", "Patriot", "Lehigh", "Lehigh", "Lehigh Mountain Hawks"),
    ("Liberty", "CUSA", "Liberty", "Liberty", "Liberty Flames"),
    ("Lindenwood", "OVC", "Lindenwood", "Lindenwood", "Lindenwood Lions"),
    ("Lipscomb", "ASUN", "Lipscomb", "Lipscomb", "Lipscomb Bisons"),
    ("Little Rock", "OVC", "Little Rock", "Little Rock", "Little Rock Trojans"),
    ("Long Beach State", "Big West", "Long Beach St.", "Long Beach State", "Long Beach State Beach"),
    ("Long Island", "NEC", "LIU", "LIU", "LIU Sharks"),
    ("Longwood", "Big South", "Longwood", "Longwood", "Longwood Lancers"),
    ("Louisiana", "Sun Belt", "Louisiana", "Louisiana", "Louisiana Ragin' Cajuns"),
    ("Louisiana Monroe", "Sun Belt", "ULM", "Louisiana Monroe", "Louisiana-Monroe Warhawks"),
    ("Louisiana Tech", "CUSA", "Louisiana Tech", "Louisiana Tech", "Louisiana Tech Bulldogs"),
    ("Louisville", "ACC", "Louisville", "Louisville", "Louisville Cardinals"),
    ("Loyola Chicago", "A-10", "Loyola Chicago", "Loyola Chicago", "Loyola Chicago Ramblers"),
    ("Loyola Maryland", "Patriot", "Loyola MD", "Loyola Maryland", "Loyola Maryland Greyhounds"),
    ("Loyola Marymount", "WCC", "Loyola Marymount", "Loyola Marymount", "Loyola Marymount Lions"),
    ("LSU", "SEC", "LSU", "LSU", "LSU Tigers"),

    # ── M ────────────────────────────────────────────────────
    ("Maine", "AE", "Maine", "Maine", "Maine Black Bears"),
    ("Manhattan", "MAAC", "Manhattan", "Manhattan", "Manhattan Jaspers"),
    ("Marist", "MAAC", "Marist", "Marist", "Marist Red Foxes"),
    ("Marquette", "Big East", "Marquette", "Marquette", "Marquette Golden Eagles"),
    ("Marshall", "Sun Belt", "Marshall", "Marshall", "Marshall Thundering Herd"),
    ("Maryland", "Big Ten", "Maryland", "Maryland", "Maryland Terrapins"),
    ("Maryland Eastern Shore", "MEAC", "Maryland Eastern Shore", "Maryland-Eastern Shore", "Maryland-Eastern Shore Hawks"),
    ("Mercyhurst", "NEC", "Mercyhurst", "Mercyhurst", "Mercyhurst Lakers"),
    ("Massachusetts", "A-10", "Massachusetts", "UMass", "Massachusetts Minutemen"),
    ("McNeese State", "Southland", "McNeese St.", "McNeese", "McNeese Cowboys"),
    ("Memphis", "AAC", "Memphis", "Memphis", "Memphis Tigers"),
    ("Mercer", "SoCon", "Mercer", "Mercer", "Mercer Bears"),
    ("Merrimack", "NEC", "Merrimack", "Merrimack", "Merrimack Warriors"),
    ("Miami (FL)", "ACC", "Miami FL", "Miami (FL)", "Miami Hurricanes"),
    ("Miami (OH)", "MAC", "Miami OH", "Miami (OH)", "Miami (OH) RedHawks"),
    ("Michigan", "Big Ten", "Michigan", "Michigan", "Michigan Wolverines"),
    ("Michigan State", "Big Ten", "Michigan St.", "Michigan State", "Michigan State Spartans"),
    ("Middle Tennessee", "CUSA", "Middle Tennessee", "Middle Tennessee", "Middle Tennessee Blue Raiders"),
    ("Milwaukee", "Horizon", "Milwaukee", "Milwaukee", "Milwaukee Panthers"),
    ("Minnesota", "Big Ten", "Minnesota", "Minnesota", "Minnesota Golden Gophers"),
    ("Mississippi State", "SEC", "Mississippi St.", "Mississippi State", "Mississippi State Bulldogs"),
    ("Mississippi Valley State", "SWAC", "Mississippi Valley St.", "Mississippi Valley State", "Mississippi Valley State Delta Devils"),
    ("Missouri", "SEC", "Missouri", "Missouri", "Missouri Tigers"),
    ("Missouri State", "MVC", "Missouri St.", "Missouri State", "Missouri State Bears"),
    ("Monmouth", "CAA", "Monmouth", "Monmouth", "Monmouth Hawks"),
    ("Montana", "Big Sky", "Montana", "Montana", "Montana Grizzlies"),
    ("Montana State", "Big Sky", "Montana St.", "Montana State", "Montana State Bobcats"),
    ("Morehead State", "OVC", "Morehead St.", "Morehead State", "Morehead State Eagles"),
    ("Morgan State", "MEAC", "Morgan St.", "Morgan State", "Morgan State Bears"),
    ("Mount St. Mary's", "MAAC", "Mount St. Mary's", "Mount St. Mary's", "Mount St. Mary's Mountaineers"),
    ("Murray State", "MVC", "Murray St.", "Murray State", "Murray State Racers"),

    # ── N ────────────────────────────────────────────────────
    ("Navy", "Patriot", "Navy", "Navy", "Navy Midshipmen"),
    ("Nebraska", "Big Ten", "Nebraska", "Nebraska", "Nebraska Cornhuskers"),
    ("Nevada", "MWC", "Nevada", "Nevada", "Nevada Wolf Pack"),
    ("New Hampshire", "AE", "New Hampshire", "New Hampshire", "New Hampshire Wildcats"),
    ("New Haven", "NE10", "New Haven", "New Haven", "New Haven Chargers"),
    ("New Mexico", "MWC", "New Mexico", "New Mexico", "New Mexico Lobos"),
    ("New Mexico State", "CUSA", "New Mexico St.", "New Mexico State", "New Mexico State Aggies"),
    ("New Orleans", "Southland", "New Orleans", "New Orleans", "New Orleans Privateers"),
    ("Niagara", "MAAC", "Niagara", "Niagara", "Niagara Purple Eagles"),
    ("Nicholls State", "Southland", "Nicholls St.", "Nicholls", "Nicholls State Colonels"),
    ("NJIT", "AE", "NJIT", "NJIT", "NJIT Highlanders"),
    ("Norfolk State", "MEAC", "Norfolk St.", "Norfolk State", "Norfolk State Spartans"),
    ("North Alabama", "ASUN", "North Alabama", "North Alabama", "North Alabama Lions"),
    ("North Carolina", "ACC", "North Carolina", "North Carolina", "North Carolina Tar Heels"),
    ("North Carolina A&T", "CAA", "NC A&T", "North Carolina A&T", "North Carolina A&T Aggies"),
    ("North Carolina Central", "MEAC", "NC Central", "North Carolina Central", "North Carolina Central Eagles"),
    ("North Carolina State", "ACC", "N.C. State", "NC State", "North Carolina State Wolfpack"),
    ("North Dakota", "Summit", "North Dakota", "North Dakota", "North Dakota Fighting Hawks"),
    ("North Dakota State", "Summit", "North Dakota St.", "North Dakota State", "North Dakota State Bison"),
    ("North Florida", "ASUN", "North Florida", "North Florida", "North Florida Ospreys"),
    ("North Texas", "AAC", "North Texas", "North Texas", "North Texas Mean Green"),
    ("Northeastern", "CAA", "Northeastern", "Northeastern", "Northeastern Huskies"),
    ("Northern Arizona", "Big Sky", "Northern Arizona", "Northern Arizona", "Northern Arizona Lumberjacks"),
    ("Northern Colorado", "Big Sky", "Northern Colorado", "Northern Colorado", "Northern Colorado Bears"),
    ("Northern Illinois", "MAC", "Northern Illinois", "Northern Illinois", "Northern Illinois Huskies"),
    ("Northern Iowa", "MVC", "Northern Iowa", "Northern Iowa", "Northern Iowa Panthers"),
    ("Northern Kentucky", "Horizon", "Northern Kentucky", "Northern Kentucky", "Northern Kentucky Norse"),
    ("Northwestern", "Big Ten", "Northwestern", "Northwestern", "Northwestern Wildcats"),
    ("Northwestern State", "Southland", "Northwestern St.", "Northwestern State", "Northwestern State Demons"),
    ("Notre Dame", "ACC", "Notre Dame", "Notre Dame", "Notre Dame Fighting Irish"),

    # ── O ────────────────────────────────────────────────────
    ("Oakland", "Horizon", "Oakland", "Oakland", "Oakland Golden Grizzlies"),
    ("Ohio", "MAC", "Ohio", "Ohio", "Ohio Bobcats"),
    ("Ohio State", "Big Ten", "Ohio St.", "Ohio State", "Ohio State Buckeyes"),
    ("Oklahoma", "SEC", "Oklahoma", "Oklahoma", "Oklahoma Sooners"),
    ("Oklahoma State", "Big 12", "Oklahoma St.", "Oklahoma State", "Oklahoma State Cowboys"),
    ("Old Dominion", "Sun Belt", "Old Dominion", "Old Dominion", "Old Dominion Monarchs"),
    ("Ole Miss", "SEC", "Mississippi", "Ole Miss", "Ole Miss Rebels"),
    ("Omaha", "Summit", "Nebraska Omaha", "Omaha", "Omaha Mavericks"),
    ("Oral Roberts", "Summit", "Oral Roberts", "Oral Roberts", "Oral Roberts Golden Eagles"),
    ("Oregon", "Big Ten", "Oregon", "Oregon", "Oregon Ducks"),
    ("Oregon State", "OSU", "Oregon St.", "Oregon State", "Oregon State Beavers"),

    # ── P ────────────────────────────────────────────────────
    ("Pacific", "WCC", "Pacific", "Pacific", "Pacific Tigers"),
    ("Penn State", "Big Ten", "Penn St.", "Penn State", "Penn State Nittany Lions"),
    ("Pennsylvania", "Ivy", "Pennsylvania", "Penn", "Penn Quakers"),
    ("Pepperdine", "WCC", "Pepperdine", "Pepperdine", "Pepperdine Waves"),
    ("Pittsburgh", "ACC", "Pittsburgh", "Pittsburgh", "Pittsburgh Panthers"),
    ("Portland", "WCC", "Portland", "Portland", "Portland Pilots"),
    ("Portland State", "Big Sky", "Portland St.", "Portland State", "Portland State Vikings"),
    ("Prairie View A&M", "SWAC", "Prairie View A&M", "Prairie View A&M", "Prairie View A&M Panthers"),
    ("Presbyterian", "Big South", "Presbyterian", "Presbyterian", "Presbyterian Blue Hose"),
    ("Princeton", "Ivy", "Princeton", "Princeton", "Princeton Tigers"),
    ("Providence", "Big East", "Providence", "Providence", "Providence Friars"),
    ("Purdue", "Big Ten", "Purdue", "Purdue", "Purdue Boilermakers"),
    ("Purdue Fort Wayne", "Horizon", "Purdue Fort Wayne", "Purdue Fort Wayne", "Purdue Fort Wayne Mastodons"),

    # ── Q-R ──────────────────────────────────────────────────
    ("Queens", "ASUN", "Queens", "Queens (NC)", "Queens Royals"),
    ("Quinnipiac", "MAAC", "Quinnipiac", "Quinnipiac", "Quinnipiac Bobcats"),
    ("Radford", "Big South", "Radford", "Radford", "Radford Highlanders"),
    ("Rhode Island", "A-10", "Rhode Island", "Rhode Island", "Rhode Island Rams"),
    ("Rice", "AAC", "Rice", "Rice", "Rice Owls"),
    ("Richmond", "A-10", "Richmond", "Richmond", "Richmond Spiders"),
    ("Rider", "MAAC", "Rider", "Rider", "Rider Broncs"),
    ("Robert Morris", "Horizon", "Robert Morris", "Robert Morris", "Robert Morris Colonials"),
    ("Rutgers", "Big Ten", "Rutgers", "Rutgers", "Rutgers Scarlet Knights"),

    # ── S ────────────────────────────────────────────────────
    ("Sacramento State", "Big Sky", "Sacramento St.", "Sacramento State", "Sacramento State Hornets"),
    ("Sacred Heart", "NEC", "Sacred Heart", "Sacred Heart", "Sacred Heart Pioneers"),
    ("Saint Francis", "NEC", "Saint Francis", "Saint Francis (PA)", "St. Francis Red Flash"),
    ("Saint Joseph's", "A-10", "Saint Joseph's", "Saint Joseph's", "Saint Joseph's Hawks"),
    ("Saint Louis", "A-10", "Saint Louis", "Saint Louis", "Saint Louis Billikens"),
    ("Saint Mary's", "WCC", "Saint Mary's", "Saint Mary's", "Saint Mary's Gaels"),
    ("Saint Peter's", "MAAC", "Saint Peter's", "Saint Peter's", "Saint Peter's Peacocks"),
    ("Sam Houston State", "CUSA", "Sam Houston St.", "Sam Houston", "Sam Houston State Bearkats"),
    ("Samford", "SoCon", "Samford", "Samford", "Samford Bulldogs"),
    ("San Diego", "WCC", "San Diego", "San Diego", "San Diego Toreros"),
    ("San Diego State", "MWC", "San Diego St.", "San Diego State", "San Diego State Aztecs"),
    ("San Francisco", "WCC", "San Francisco", "San Francisco", "San Francisco Dons"),
    ("San Jose State", "MWC", "San Jose St.", "San José State", "San Jose State Spartans"),
    ("Santa Clara", "WCC", "Santa Clara", "Santa Clara", "Santa Clara Broncos"),
    ("Seattle", "WAC", "Seattle", "Seattle U", "Seattle Redhawks"),
    ("Seton Hall", "Big East", "Seton Hall", "Seton Hall", "Seton Hall Pirates"),
    ("Siena", "MAAC", "Siena", "Siena", "Siena Saints"),
    ("SMU", "ACC", "SMU", "SMU", "SMU Mustangs"),
    ("South Alabama", "Sun Belt", "South Alabama", "South Alabama", "South Alabama Jaguars"),
    ("South Carolina", "SEC", "South Carolina", "South Carolina", "South Carolina Gamecocks"),
    ("South Carolina State", "MEAC", "South Carolina St.", "South Carolina State", "South Carolina State Bulldogs"),
    ("South Dakota", "Summit", "South Dakota", "South Dakota", "South Dakota Coyotes"),
    ("South Dakota State", "Summit", "South Dakota St.", "South Dakota State", "South Dakota State Jackrabbits"),
    ("South Florida", "AAC", "South Florida", "South Florida", "South Florida Bulls"),
    ("Southeast Missouri State", "OVC", "Southeast Missouri St.", "Southeast Missouri State", "Southeast Missouri State Redhawks"),
    ("Southeastern Louisiana", "Southland", "SE Louisiana", "Southeastern Louisiana", "Southeastern Louisiana Lions"),
    ("Southern", "SWAC", "Southern", "Southern", "Southern Jaguars"),
    ("SIU Edwardsville", "OVC", "SIU Edwardsville", "SIU Edwardsville", "SIU Edwardsville Cougars"),
    ("Southern Illinois", "MVC", "Southern Illinois", "Southern Illinois", "Southern Illinois Salukis"),
    ("Southern Indiana", "OVC", "Southern Indiana", "Southern Indiana", "Southern Indiana Screaming Eagles"),
    ("Southern Miss", "Sun Belt", "Southern Miss", "Southern Miss", "Southern Miss Golden Eagles"),
    ("Southern Utah", "WAC", "Southern Utah", "Southern Utah", "Southern Utah Thunderbirds"),
    ("St. Bonaventure", "A-10", "St. Bonaventure", "St. Bonaventure", "St. Bonaventure Bonnies"),
    ("St. John's", "Big East", "St. John's", "St. John's", "St. John's Red Storm"),
    ("St. Thomas", "Summit", "St. Thomas", "St. Thomas (MN)", "St. Thomas Tommies"),
    ("Stanford", "ACC", "Stanford", "Stanford", "Stanford Cardinal"),
    ("Stephen F. Austin", "Southland", "Stephen F. Austin", "Stephen F. Austin", "Stephen F. Austin Lumberjacks"),
    ("Stetson", "ASUN", "Stetson", "Stetson", "Stetson Hatters"),
    ("Stonehill", "NEC", "Stonehill", "Stonehill", "Stonehill Skyhawks"),
    ("Stony Brook", "CAA", "Stony Brook", "Stony Brook", "Stony Brook Seawolves"),
    ("Syracuse", "ACC", "Syracuse", "Syracuse", "Syracuse Orange"),

    # ── T ────────────────────────────────────────────────────
    ("Tarleton State", "WAC", "Tarleton St.", "Tarleton State", "Tarleton State Texans"),
    ("TCU", "Big 12", "TCU", "TCU", "TCU Horned Frogs"),
    ("Temple", "AAC", "Temple", "Temple", "Temple Owls"),
    ("Tennessee", "SEC", "Tennessee", "Tennessee", "Tennessee Volunteers"),
    ("Tennessee State", "OVC", "Tennessee St.", "Tennessee State", "Tennessee State Tigers"),
    ("Tennessee Tech", "OVC", "Tennessee Tech", "Tennessee Tech", "Tennessee Tech Golden Eagles"),
    ("The Citadel", "SoCon", "The Citadel", "The Citadel", "The Citadel Bulldogs"),
    ("Texas", "SEC", "Texas", "Texas", "Texas Longhorns"),
    ("Texas A&M", "SEC", "Texas A&M", "Texas A&M", "Texas A&M Aggies"),
    ("Texas A&M-CC", "Southland", "Texas A&M Corpus Chris", "Texas A&M-Corpus Christi", "Texas A&M-CC Islanders"),
    ("Texas Southern", "SWAC", "Texas Southern", "Texas Southern", "Texas Southern Tigers"),
    ("Texas State", "Sun Belt", "Texas St.", "Texas State", "Texas State Bobcats"),
    ("Texas Tech", "Big 12", "Texas Tech", "Texas Tech", "Texas Tech Red Raiders"),
    ("Toledo", "MAC", "Toledo", "Toledo", "Toledo Rockets"),
    ("Towson", "CAA", "Towson", "Towson", "Towson Tigers"),
    ("Troy", "Sun Belt", "Troy", "Troy", "Troy Trojans"),
    ("Tulane", "AAC", "Tulane", "Tulane", "Tulane Green Wave"),
    ("Tulsa", "AAC", "Tulsa", "Tulsa", "Tulsa Golden Hurricane"),

    # ── U ────────────────────────────────────────────────────
    ("UAB", "AAC", "UAB", "UAB", "UAB Blazers"),
    ("UCF", "Big 12", "UCF", "UCF", "UCF Knights"),
    ("UC Davis", "Big West", "UC Davis", "UC Davis", "UC Davis Aggies"),
    ("UC Irvine", "Big West", "UC Irvine", "UC Irvine", "UC Irvine Anteaters"),
    ("UC Riverside", "Big West", "UC Riverside", "UC Riverside", "UC Riverside Highlanders"),
    ("UC San Diego", "Big West", "UC San Diego", "UC San Diego", "UC San Diego Tritons"),
    ("UC Santa Barbara", "Big West", "UCSB", "UC Santa Barbara", "UC Santa Barbara Gauchos"),
    ("UCLA", "Big Ten", "UCLA", "UCLA", "UCLA Bruins"),
    ("UMBC", "AE", "UMBC", "UMBC", "UMBC Retrievers"),
    ("UNC Asheville", "Big South", "UNC Asheville", "UNC Asheville", "UNC Asheville Bulldogs"),
    ("UNC Greensboro", "SoCon", "UNC Greensboro", "UNC Greensboro", "UNC Greensboro Spartans"),
    ("UNC Wilmington", "CAA", "UNC Wilmington", "UNC Wilmington", "UNC Wilmington Seahawks"),
    ("UMass Lowell", "AE", "UMass Lowell", "UMass Lowell", "UMass Lowell River Hawks"),
    ("UNLV", "MWC", "UNLV", "UNLV", "UNLV Rebels"),
    ("USC", "Big Ten", "USC", "USC", "USC Trojans"),
    ("USC Upstate", "Big South", "USC Upstate", "USC Upstate", "USC Upstate Spartans"),
    ("UT Arlington", "WAC", "UT Arlington", "UT Arlington", "UT Arlington Mavericks"),
    ("UT Martin", "OVC", "Tennessee Martin", "UT Martin", "UT Martin Skyhawks"),
    ("UT Rio Grande Valley", "WAC", "UT Rio Grande Valley", "UT Rio Grande Valley", "UTRGV Vaqueros"),
    ("Utah", "Big 12", "Utah", "Utah", "Utah Utes"),
    ("Utah State", "MWC", "Utah St.", "Utah State", "Utah State Aggies"),
    ("Utah Tech", "WAC", "Utah Tech", "Utah Tech", "Utah Tech Trailblazers"),
    ("Utah Valley", "WAC", "Utah Valley", "Utah Valley", "Utah Valley Wolverines"),
    ("UTEP", "CUSA", "UTEP", "UTEP", "UTEP Miners"),
    ("UTSA", "AAC", "UTSA", "UTSA", "UTSA Roadrunners"),

    # ── V ────────────────────────────────────────────────────
    ("Valparaiso", "MVC", "Valparaiso", "Valparaiso", "Valparaiso Beacons"),
    ("VCU", "A-10", "VCU", "VCU", "VCU Rams"),
    ("Vanderbilt", "SEC", "Vanderbilt", "Vanderbilt", "Vanderbilt Commodores"),
    ("Vermont", "AE", "Vermont", "Vermont", "Vermont Catamounts"),
    ("Villanova", "Big East", "Villanova", "Villanova", "Villanova Wildcats"),
    ("Virginia", "ACC", "Virginia", "Virginia", "Virginia Cavaliers"),
    ("Virginia Tech", "ACC", "Virginia Tech", "Virginia Tech", "Virginia Tech Hokies"),
    ("VMI", "SoCon", "VMI", "VMI", "VMI Keydets"),

    # ── W ────────────────────────────────────────────────────
    ("Wagner", "NEC", "Wagner", "Wagner", "Wagner Seahawks"),
    ("Wake Forest", "ACC", "Wake Forest", "Wake Forest", "Wake Forest Demon Deacons"),
    ("Washington", "Big Ten", "Washington", "Washington", "Washington Huskies"),
    ("Washington State", "WCC", "Washington St.", "Washington State", "Washington State Cougars"),
    ("Weber State", "Big Sky", "Weber St.", "Weber State", "Weber State Wildcats"),
    ("West Georgia", "ASUN", "West Georgia", "West Georgia", "West Georgia Wolves"),
    ("West Virginia", "Big 12", "West Virginia", "West Virginia", "West Virginia Mountaineers"),
    ("Western Carolina", "SoCon", "Western Carolina", "Western Carolina", "Western Carolina Catamounts"),
    ("Western Illinois", "Summit", "Western Illinois", "Western Illinois", "Western Illinois Leathernecks"),
    ("Western Kentucky", "CUSA", "Western Kentucky", "Western Kentucky", "Western Kentucky Hilltoppers"),
    ("Western Michigan", "MAC", "Western Michigan", "Western Michigan", "Western Michigan Broncos"),
    ("Wichita State", "AAC", "Wichita St.", "Wichita State", "Wichita State Shockers"),
    ("William & Mary", "CAA", "William & Mary", "William & Mary", "William & Mary Tribe"),
    ("Winthrop", "Big South", "Winthrop", "Winthrop", "Winthrop Eagles"),
    ("Wisconsin", "Big Ten", "Wisconsin", "Wisconsin", "Wisconsin Badgers"),
    ("Wofford", "SoCon", "Wofford", "Wofford", "Wofford Terriers"),
    ("Wright State", "Horizon", "Wright St.", "Wright State", "Wright State Raiders"),
    ("Wyoming", "MWC", "Wyoming", "Wyoming", "Wyoming Cowboys"),

    # ── X-Y ──────────────────────────────────────────────────
    ("Xavier", "Big East", "Xavier", "Xavier", "Xavier Musketeers"),
    ("Yale", "Ivy", "Yale", "Yale", "Yale Bulldogs"),
    ("Youngstown State", "Horizon", "Youngstown St.", "Youngstown State", "Youngstown State Penguins"),
]

# Build fast lookup dicts (populated on import)
_BY_TORVIK: dict[str, str] = {}
_BY_NCAA: dict[str, str] = {}
_BY_ODDS: dict[str, str] = {}
_BY_CANONICAL: dict[str, tuple] = {}

for _entry in TEAM_MAP:
    _canon, _conf, _torv, _ncaa, _odds = _entry
    _BY_CANONICAL[_canon.lower()] = _entry
    if _torv:
        _BY_TORVIK[_torv.lower()] = _canon
    if _ncaa:
        _BY_NCAA[_ncaa.lower()] = _canon
    if _odds:
        _BY_ODDS[_odds.lower()] = _canon


def resolve_canonical_name(source_name: str, source: str = "any") -> str | None:
    """Resolve a source-specific team name to the canonical name.

    Args:
        source_name: Team name as it appears in the data source.
        source: One of 'torvik', 'ncaa', 'odds', or 'any' (tries all).

    Returns:
        Canonical team name, or None if not found.
    """
    key = source_name.strip().lower()

    if source == "torvik":
        return _BY_TORVIK.get(key)
    elif source == "ncaa":
        return _BY_NCAA.get(key)
    elif source == "odds":
        return _BY_ODDS.get(key)
    else:
        # Try canonical first, then each source
        if key in _BY_CANONICAL:
            return _BY_CANONICAL[key][0]
        return _BY_TORVIK.get(key) or _BY_NCAA.get(key) or _BY_ODDS.get(key)


def seed_teams(db: DatabaseManager) -> int:
    """Insert all teams from the mapping matrix into the database.

    Returns the number of teams upserted.
    """
    count = 0
    for canon, conf, torv, ncaa, odds in TEAM_MAP:
        upsert_team(
            db,
            name=canon,
            conference=conf,
            torvik_name=torv,
            ncaa_name=ncaa,
            odds_api_name=odds,
        )
        count += 1
    return count


def resolve_team_id(db: DatabaseManager, source_name: str, source: str = "any") -> int | None:
    """Resolve a source-specific team name to a team_id in the database.

    First resolves to canonical name via the mapping matrix,
    then looks up the team_id in the database.
    """
    canonical = resolve_canonical_name(source_name, source)
    if canonical:
        return find_team_id(db, canonical)
    # Fallback: try direct database lookup
    return find_team_id(db, source_name)


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    if not config.database_url:
        print("ERROR: DATABASE_URL not set. Add it to .env")
        exit(1)

    db = DatabaseManager(config.database_url)
    count = seed_teams(db)
    print(f"Seeded {count} teams into the database.")
