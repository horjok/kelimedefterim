{
    let correctAnswers = 8;
    let wrongAnswers = 2;
 
    let totalQuestions = correctAnswers + wrongAnswers;           
    let difference = correctAnswers - wrongAnswers;                
    let score = correctAnswers * 10;                          
    let accuracy = (correctAnswers / totalQuestions) * 100;  
 
    let streakDays = 17;
    let fullWeeks = Math.floor(streakDays / 7);   
    let additionalDays = streakDays % 7;               
 
    let series = 5;
    series += 1;   
    series++;      
 
    let isPassed = accuracy >= 70 && wrongAnswers <= 3;   
    let isRibbon = score === 100 || series >= 7;

    show("toplamSoru", totalQuestions);
    show("fark", difference);
    show("operator-puan", score);
    show("basariYuzdesi", "%" + accuracy);
    show("tamHafta", fullWeeks);
    show("artanGun", additionalDays);
    show("seri", series);
    show("gectiMi", isPassed);
    show("rozetMi", isRibbon);

}